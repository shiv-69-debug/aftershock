"""Tenant-bound GraphRAG SDK bridge. Only the trusted Node backend chooses --graph."""
import argparse
import asyncio
import base64
import contextlib
import json
import logging
import os
import re
import sys
import tempfile

from graphrag_sdk import (
    ConnectionConfig, Context, Embedder, Entity, GraphExtraction, GraphRAG,
    LiteLLM, LLMExtractor, Ontology, Relation,
)
from graphrag_sdk.retrieval.strategies.local import LocalRetrieval
from sentence_transformers import SentenceTransformer


class LocalEmbedder(Embedder):
    def __init__(self):
        self.model = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")

    @property
    def model_name(self):
        return "sentence-transformers/all-MiniLM-L6-v2"

    def embed_query(self, text, **kwargs):
        return self.model.encode(text, show_progress_bar=False).tolist()

    def embed_documents(self, texts, **kwargs):
        return self.model.encode(texts, show_progress_bar=False).tolist() if texts else []


def ontology():
    labels = ["Service", "Team", "Incident", "Runbook", "Ticket", "System"]
    return Ontology(
        entities=[Entity(label=label) for label in labels],
        relations=[
            Relation(label="DEPENDS_ON", patterns=[("Service", "Service"), ("Service", "System")]),
            Relation(label="OWNS", patterns=[("Team", "Service"), ("Team", "System")]),
            Relation(label="AFFECTS", patterns=[("Incident", "Service"), ("Ticket", "Service")]),
            Relation(label="DESCRIBES", patterns=[("Runbook", "Service"), ("Ticket", "Incident")]),
        ],
    )


async def run(graph, request):
    if not re.fullmatch(r"asw_[a-f0-9]{32}_knowledge", graph):
        raise ValueError("Invalid workspace graph")
    model = os.getenv("GROQ_MODEL", "openai/gpt-oss-120b")
    kwargs = {"reasoning_effort": "low"} if model.startswith("openai/gpt-oss") else {}
    llm = LiteLLM(model="groq/" + model, temperature=0.0, max_tokens=2048, **kwargs)
    embedder = LocalEmbedder()
    connection = ConnectionConfig(graph_name=graph, host=os.getenv("FALKORDB_HOST", "falkordb"), port=int(os.getenv("FALKORDB_PORT", "6379")), password=os.getenv("FALKORDB_PASSWORD") or None)
    async with GraphRAG(connection=connection, llm=llm, embedder=embedder, ontology=ontology(), embedding_dimension=384) as rag:
        if request["op"] == "ingest":
            extractor = GraphExtraction(llm, entity_extractor=LLMExtractor(llm), max_concurrency=1)
            ctx = Context(latency_budget_ms=540_000)
            if request.get("fileType") == "pdf":
                with tempfile.NamedTemporaryFile(suffix=".pdf") as source:
                    source.write(base64.b64decode(request["contentBase64"], validate=True))
                    source.flush()
                    result = await rag.ingest(source.name, document_id=request["source_id"], extractor=extractor, ctx=ctx)
            else:
                result = await rag.ingest(text=request["text"], document_id=request["source_id"], extractor=extractor, ctx=ctx)
            finalized = await rag.finalize()
            counts = await rag.graph_store.query_raw("MATCH (n) RETURN count(n)")
            return {"ingestion": result.model_dump(mode="json"), "finalize": finalized.model_dump(mode="json"), "graphNodes": counts.result_set[0][0], "embeddingModel": embedder.model_name}
        if request["op"] == "retrieve":
            strategy = LocalRetrieval(rag.graph_store, rag.vector_store, embedder, top_k=5, include_entities=True)
            result = await rag.retrieve(request["question"], strategy=strategy)
            ids = list({item.metadata["chunk_id"] for item in result.items if "chunk_id" in item.metadata})
            if not ids:
                return {"sources": [], "retrieval": result.model_dump(mode="json")}
            rows = await rag.graph_store.query_raw("MATCH (d:Document)-[:PART_OF]->(c:Chunk) WHERE c.id IN $ids RETURN d.id,c.id,c.index,c.text", params={"ids": ids})
            return {"sources": [dict(zip(["sourceId", "chunkId", "chunkIndex", "text"], row)) for row in rows.result_set], "retrieval": result.model_dump(mode="json")}
        raise ValueError("Unsupported operation")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--graph", required=True)
    args = parser.parse_args()
    logging.disable(logging.CRITICAL)
    try:
        request = json.loads(sys.stdin.buffer.read().decode("utf-8"))
        with contextlib.redirect_stdout(sys.stderr):
            response = asyncio.run(run(args.graph, request))
        status = 0
    except Exception as exc:
        # Exception class only: provider payloads can include user text or credentials.
        response = {"error": type(exc).__name__}
        status = 1
    sys.stdout.write(json.dumps(response, ensure_ascii=False) + "\n")
    raise SystemExit(status)
