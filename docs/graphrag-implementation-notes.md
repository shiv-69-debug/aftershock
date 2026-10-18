# FalkorDB GraphRAG SDK implementation research

Verified 2026-10-18 against PyPI metadata and the `v1.4.0` source tag, commit `70ea2a2be5ee956a79db285503cfe96ca7330478`. **Source-verified, not execution-tested.** No dependencies installed, provider/database calls made, secrets inspected, or application files changed.

## Recommendation and version boundary

Use **`graphrag-sdk==1.4.0`**, its async `GraphRAG` facade, Groq through `LiteLLM`, and a local sentence-transformers `Embedder`. Use SDK `LocalRetrieval` initially: it preserves chunk IDs, allowing a deterministic join to source documents. This is actual SDK extraction, persistence, vector retrieval and entity expansion. [1–8]

Installed interpreter: `python --version` returned **Python 3.13.14**. Release metadata requires **Python >=3.10** with no upper bound; classifiers mention 3.10–3.12. This satisfies the SDK's declared constraint, but does not prove that every native dependency installs on this Windows/Python combination. No dependency-resolution/install test was authorized. [1,2]

`KnowledgeGraph`, `KnowledgeGraphModelConfig`, `LiteModel`, `kg.process_sources(sources)`, `kg.chat_session().send_message(...)`, and the old `graphrag_sdk.source` classes belong to the **0.x API**. The v0.8.1 README demonstrates these; upstream recommends pinning 0.8.2 for legacy consumers. They are not the current API. In 1.4.0, `GraphSchema`, `EntityType`, `RelationType`, `PropertyType`, and `schema=` are deprecated aliases for `Ontology`, `Entity`, `Relation`, `Attribute`, and `ontology=`. `KnowledgeGraph` has no such current alias. [3,14,15]

## Dependencies

Proposed requirement (not installed):

```text
graphrag-sdk[litellm,sentence-transformers]==1.4.0
```

For PDF and Markdown file loaders, additionally select `pdf,markdown` extras:

```text
graphrag-sdk[litellm,sentence-transformers,pdf,markdown]==1.4.0
```

Exact declared direct requirements: `pydantic>=2.0,<3.0`, `falkordb>=1.0,<2`, `numpy>=1.24,<3`, `python-dotenv>=1.0`, `tiktoken>=0.5,<1.0`, `gliner>=0.2,<1`, `hnswlib>=0.8`, `scipy>=1.11,<2`. Selected extras add `litellm>=1.83.0,<2.0`, `sentence-transformers>=2.0`; PDF adds `pypdf>=6.9.2`; Markdown adds `markdown-it-py>=3.0.0`. These are upstream constraints, not a tested transitive lockfile. GLiNER/hnswlib remain dependencies even when choosing LLM-based extraction. Native packages may require Windows build tooling where suitable wheels are unavailable. [1,2]

## Exact current API surface

Signatures below omit `self`, retaining current argument names/defaults; imports are from `graphrag_sdk` unless indicated. The tag's `docs/api-reference.md` is stale in several places; executable source takes precedence. [3,4,9]

```python
GraphRAG(
    connection: FalkorDBConnection | ConnectionConfig,
    llm: LLMInterface,
    embedder: Embedder,
    ontology: Ontology | None = None,
    retrieval_strategy: RetrievalStrategy | None = None,
    embedding_dimension: int = 256,
    *, schema: Ontology | None = None,  # deprecated
)

async def ingest(
    source: str | list[str] | None = None, *,
    text: str | None = None,
    document_id: str | None = None,
    loader: LoaderStrategy | None = None,
    chunker: ChunkingStrategy | None = None,
    extractor: ExtractionStrategy | None = None,
    resolver: ResolutionStrategy | None = None,
    max_concurrency: int = 3,
    ctx: Context | None = None,
) -> IngestionResult | list[IngestionResult | Exception]: ...

async def retrieve(
    question: str, *, strategy: RetrievalStrategy | None = None,
    reranker: RerankingStrategy | None = None,
    ctx: Context | None = None,
) -> RetrieverResult: ...

async def finalize() -> FinalizeResult: ...
async def get_ontology() -> Ontology: ...
async def refresh_ontology() -> Ontology: ...
async def set_ontology(ontology: Ontology) -> Ontology: ...
async def save_ontology(path: str, *, indent: int = 2) -> None: ...
```

`completion(question, return_context=True, strategy=...)` returns `RagResult`: `answer`, `retriever_result`, `metadata`. `RetrieverResult.items` contain `content`, `metadata`, and optional `score`. Models support `model_dump(mode="json")` / `model_dump_json()`. `finalize()` returns a Pydantic `FinalizeResult`, **not a dict**: `null_stubs_removed`, `entities_deduplicated`, `entities_embedded`, `relationships_embedded`, `indexes`. [4,9]

### Ontology and extraction

```python
from graphrag_sdk import Ontology, Entity, Relation, Attribute

ontology = Ontology(
    entities=[
        Entity(label="Person", properties=[Attribute(name="birth_year", type="INTEGER")]),
        Entity(label="Organization"),
    ],
    relations=[Relation(label="WORKS_AT", patterns=[("Person", "Organization")])],
)
# For JSON configuration:
ontology = Ontology.model_validate(ontology.model_dump())
# File APIs: Ontology.from_file(path), ontology.save_to_file(path)
```

`Attribute` types: STRING, INTEGER, FLOAT, BOOLEAN, DATE, LIST. Both `Entity` and `Relation` accept `properties: list[Attribute]`. `Relation.patterns` is directional. `Ontology.from_sources(sources, llm=llm, method="llm", ...)` is async discovery, not ingestion; it samples sources and returns a draft. Explicitly supplying an ontology avoids this additional LLM pass. [9,10]

```python
GraphExtraction(
    llm: LLMInterface, *, entity_extractor: EntityExtractor | None = None,
    coref_resolver: CorefResolver | None = None,
    entity_types: list[str] | None = None,
    max_concurrency: int | None = None,
)
async def extract(chunks: TextChunks, ontology: Ontology, ctx: Context) -> GraphData: ...
```

Default extraction uses local `GLiNERExtractor()` for entity candidates, then the supplied LLM for verification/relations. `GraphExtraction(llm, entity_extractor=LLMExtractor(llm), max_concurrency=1)` uses the supplied Groq LLM for both steps and avoids loading a GLiNER model. `GraphData` includes nodes, relationships, mentions, extracted_entities and extracted_relations. Calling `extract()` alone does **not** persist documents or index them; use `ingest()` for that. [10]

### Sources and loaders

- Raw text: `await rag.ingest(text=body, document_id=source_id)`. **Do not also pass positional `source`**: current code rejects `source` plus `text`, despite older quickstarts showing that combination. Text mode also rejects `loader=`. [4]
- Files: `await rag.ingest(path, document_id=source_id)`. Auto-loader chooses `.pdf` -> `PdfLoader`, `.md` -> `MarkdownLoader`, otherwise `TextLoader`. File IDs default to normalized paths; raw-text IDs default to generated IDs. Always pass a stable product source ID. `__pending__` is reserved inside document IDs. [4]
- Current built-in document loaders are text, Markdown and PDF. CSV/JSONL/HTML may be read as plain text, but this release does not provide the old structured source adapters or a URL loader. Do not infer structured parsing or URL fetching from 0.x format lists or newer `main` examples. [3,4,14]
- PDF prefers PyMuPDF if installed, otherwise pypdf. It concatenates extracted page text and retains document `page_count`/backend metadata, **not per-chunk page numbers**; there is no OCR in this loader. Page-accurate citations require a custom loader/chunker. [11]
- Default chunker in 1.4.0 is `SentenceTokenCapChunking(max_tokens=512, overlap_sentences=2)`, not the older documented 1,000-character default. [4]

## Groq and embeddings without an OpenAI key

```python
from graphrag_sdk import LiteLLM

# Runtime inherits GROQ_API_KEY from the parent process; no dotenv loading.
llm = LiteLLM(model="groq/llama-3.3-70b-versatile", temperature=0.0)
```

SDK signature: `LiteLLM(model, *, api_key=None, api_base=None, api_version=None, temperature=0.0, max_tokens=None, **kwargs)`. It forwards to LiteLLM completion calls; LiteLLM documents `groq/<model>` and `GROQ_API_KEY`. Groq availability/account access was not tested. For a generic OpenAI-compatible route, the supported configuration is `LiteLLM(model="openai/<provider-model-id>", api_base="https://api.groq.com/openai/v1", api_key=<runtime Groq key>)`; prefer the native `groq/` route so provider-specific handling is retained. Groq documents unsupported OpenAI parameters such as `logprobs`, `logit_bias`, `top_logprobs`, and message `name`. [5,6,16]

**There is no default embedder in the current facade:** it is required. The constructor's default _dimension_ is 256, which is not an embedding model. A Groq chat key does not configure an embedding backend. Use the custom `Embedder` contract below for local embeddings; no OpenAI key is needed. `LiteLLMEmbedder` is another option for a separately configured supported embedding service. [4,5,8]

The public `sentence-transformers/all-MiniLM-L6-v2` model produces **384-dimensional** vectors and truncates beyond **256 wordpieces**. Load/download/cache its weights ahead of serving; first-run model downloads are still network access, even though embedding inference is local. The SDK's 512-token default chunk size can exceed this model's limit; tune chunking using the embedder's tokenizer for production (SDK tiktoken counts are not equivalent to wordpieces). [12]

## Minimal proposed CLI bridge

This is a source-checked reference snippet, not an installed or tested application implementation. It accepts an explicit graph argument plus a single JSON request on stdin, and returns a single JSON response on stdout. The parent supplies credentials through inherited environment variables at runtime. Auth and graph naming remain the caller's responsibility.

The SDK will touch **both** the explicitly supplied data graph and its deterministic `<graph>__ontology` companion. Stock `GraphRAG` cannot be configured to keep ontology storage inside just the data graph. `Context(tenant_id=...)` is not a replacement for `ConnectionConfig(graph_name=...)`. [4,13]

```python
import argparse
import asyncio
import contextlib
import json
import logging
import os
import sys

from graphrag_sdk import (
    ConnectionConfig, Context, Embedder, GraphExtraction, GraphRAG,
    LiteLLM, LLMExtractor, Ontology,
)
from graphrag_sdk.retrieval.strategies.local import LocalRetrieval
from sentence_transformers import SentenceTransformer


class LocalEmbedder(Embedder):
    def __init__(self):
        self.model = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")

    @property
    def model_name(self) -> str:
        return "sentence-transformers/all-MiniLM-L6-v2"

    def embed_query(self, text: str, **kwargs) -> list[float]:
        return self.model.encode(text, show_progress_bar=False).tolist()

    def embed_documents(self, texts: list[str], **kwargs) -> list[list[float]]:
        if not texts:
            return []
        return self.model.encode(texts, show_progress_bar=False).tolist()


async def run(graph: str, request: dict) -> dict:
    if not graph.strip():
        raise ValueError("graph is required")
    op = request["op"]
    if op not in {"ingest", "retrieve"}:
        raise ValueError("unsupported operation")
    llm = LiteLLM(model="groq/llama-3.3-70b-versatile", temperature=0.0)
    embedder = LocalEmbedder()
    connection = ConnectionConfig(
        graph_name=graph,
        host=os.getenv("FALKORDB_HOST", "localhost"),
        port=int(os.getenv("FALKORDB_PORT", "6379")),
        username=os.getenv("FALKORDB_USERNAME"),
        password=os.getenv("FALKORDB_PASSWORD"),
    )
    ontology = (Ontology.model_validate(request["ontology"])
                if "ontology" in request else None)
    async with GraphRAG(
        connection=connection, llm=llm, embedder=embedder,
        ontology=ontology, embedding_dimension=384,
    ) as rag:
        if op == "ingest":
            result = await rag.ingest(
                text=request["text"], document_id=request["source_id"],
                extractor=GraphExtraction(
                    llm, entity_extractor=LLMExtractor(llm), max_concurrency=1,
                ),
                ctx=Context(latency_budget_ms=600_000),
            )
            finalized = await rag.finalize()
            return {"graph": graph, "ingestion": result.model_dump(mode="json"),
                    "finalize": finalized.model_dump(mode="json")}

        strategy = LocalRetrieval(
            rag.graph_store, rag.vector_store, embedder,
            top_k=5, include_entities=True,
        )
        result = await rag.retrieve(request["question"], strategy=strategy)
        ids = [item.metadata["chunk_id"] for item in result.items]
        # Fetch exact persisted source text; content may also include entities.
        rows = await rag.graph_store.query_raw(
            "MATCH (d:Document)-[:PART_OF]->(c:Chunk) "
            "WHERE c.id IN $ids "
            "RETURN d.id, d.path, c.id, c.index, c.text",
            params={"ids": ids},
        )
        sources = [dict(zip(
            ["source_id", "path", "chunk_id", "chunk_index", "text"], row
        )) for row in rows.result_set]
        return {"graph": graph, "retrieval": result.model_dump(mode="json"),
                "sources": sources}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--graph", required=True)
    args = parser.parse_args()
    # Avoid emitting provider exception bodies or credential-bearing logs.
    logging.disable(logging.CRITICAL)
    try:
        request = json.loads(sys.stdin.buffer.read().decode("utf-8"))
        with contextlib.redirect_stdout(sys.stderr):
            response = asyncio.run(run(args.graph, request))
    except Exception as exc:
        response = {"error": type(exc).__name__}
        status = 1
    else:
        status = 0
    sys.stdout.buffer.write((json.dumps(response, ensure_ascii=False) + "\n").encode("utf-8"))
    raise SystemExit(status)
```

Request shapes:

```json
{ "op": "ingest", "source_id": "document-123", "text": "Alice works at Acme." }
```

```json
{ "op": "retrieve", "question": "Where does Alice work?" }
```

Invoke with `python -u bridge.py --graph <explicit-workspace-graph>` and write the JSON through the subprocess stdin. No shell interpolation or key-bearing command-line arguments are needed. The reference returns retrieval evidence, not generated prose. For SDK generation, `await rag.completion(question, strategy=strategy, return_context=True)` yields the same local chunk IDs in `answer.retriever_result`; join those IDs to sources as above. Sources are evidence attachments, not proof of each generated claim. [4,7]

## Storage, provenance and integration pitfalls

- Data shape: `(Document)-[:PART_OF]->(Chunk)`, `(Chunk)-[:NEXT_CHUNK]->(Chunk)`, `(Entity)-[:MENTIONED_IN]->(Chunk)`. **PART_OF points from document to chunk.** Entity nodes also have `__Entity__`; extracted edges use physical type `RELATES` with logical `rel_type`, `fact`, `description`, `source_chunk_ids`, optional spans and declared attributes. Source IDs/spans are extraction provenance, not a truth guarantee. [10,17]
- Documents persist `id`, `path`, loader metadata and SHA-256 `content_hash`; chunks persist `id`, `text`, `index` and chunk metadata. Raw-text `path` is the chosen source ID, not an automatically resolved URL/title. Keep product source metadata keyed by source ID, or use a custom file-mode loader returning `DocumentOutput(document_info=DocumentInfo(...))`. [4,17]
- The companion ontology graph stores `Entity`, `Relation`, `Property` nodes and `HAS_PROPERTY`, `SOURCE`, `TARGET` edges. It is the canonical persisted ontology across processes. A data-graph `__GraphRAGConfig__` node stores embedding model, dimension, SDK version and timestamp. Reopening with incompatible embedding model/dimension raises `ConfigError`. [4,13]
- Declare schema before first ingestion. Normal registration allows new labels and existing subsets, but rejects adding properties/patterns to registered labels or contradicting types. Current explicit evolution methods include `add_attribute`, `add_entity`, `add_relation_pattern`, renames and backfills. Some ontology-store docstrings still say evolution is unavailable; the facade implements it. [4,13]
- Default `MultiPathRetrieval` combines entity discovery, relationships, facts and passages, but its assembly drops passage IDs: `rerank_chunks` returns strings, and `assemble_raw_result` combines passages into a section. `return_context=True` alone therefore does **not** produce machine-usable source citations for the default strategy. `LocalRetrieval` preserves `metadata.chunk_id`; this is why the bridge selects it. Do not attach independently retrieved local sources to a multi-path answer as if they were its exact evidence. [7,18]
- SDK `_clean_answer` removes `(Source: ...)` and `[Source: ...]` inline citations. Keep citations in a separate structured response rather than relying on generated source markers. [4]
- `finalize()` performs graph-wide deduplication, entity/relationship embedding and index creation. Batch documents and call it once per batch; inspect `FinalizeResult.indexes`. Counts are pipeline counts, not guaranteed newly inserted DB-object counts. [4,17]
- Repeated `ingest` is not a document-replacement protocol. For replacement/upsert use `await rag.update(text=body, document_id=id, if_missing="ingest", extractor=extractor)` and finalize after the batch. Chunk UUIDs may change. [4]
- LLM extraction can soft-fail: invalid JSON produces empty extraction; failed verification can fall back to entity candidates; exhausted context budget can skip extraction. `chunks_indexed > 0` is not proof that useful entities/relations were extracted. Inspect graph counts/mentions and sample provenance before reporting ingestion quality. The reference keeps extraction concurrency low for Groq but does not guarantee complete extraction. [10,17]
- SDK dependency declaration includes dotenv, but the bridge does not call `load_dotenv`. Parent-provided runtime environment supplies the key. Avoid forwarding raw stderr/provider exceptions to the product response; the reference only serializes the exception class. Local model loading per CLI invocation adds startup cost; a persistent Python worker can reuse it later.

## Primary sources

1. [PyPI package/version/Python/dependency metadata](https://pypi.org/pypi/graphrag-sdk/json)
2. [v1.4.0 pyproject.toml](https://github.com/FalkorDB/GraphRAG-SDK/blob/v1.4.0/graphrag_sdk/pyproject.toml)
3. [v1.4.0 exports and deprecated aliases](https://github.com/FalkorDB/GraphRAG-SDK/blob/v1.4.0/graphrag_sdk/src/graphrag_sdk/__init__.py)
4. [v1.4.0 GraphRAG facade: signatures, loaders, lifecycle, config and generation](https://github.com/FalkorDB/GraphRAG-SDK/blob/v1.4.0/graphrag_sdk/src/graphrag_sdk/api/main.py)
5. [v1.4.0 LiteLLM provider implementation](https://github.com/FalkorDB/GraphRAG-SDK/blob/v1.4.0/graphrag_sdk/src/graphrag_sdk/core/providers/litellm.py)
6. [LiteLLM Groq provider documentation](https://docs.litellm.ai/docs/providers/groq)
7. [v1.4.0 LocalRetrieval: chunk IDs and entity expansion](https://github.com/FalkorDB/GraphRAG-SDK/blob/v1.4.0/graphrag_sdk/src/graphrag_sdk/retrieval/strategies/local.py)
8. [v1.4.0 provider contracts/custom embedder guide](https://github.com/FalkorDB/GraphRAG-SDK/blob/v1.4.0/docs/providers.md)
9. [v1.4.0 actual model definitions and ontology discovery signature](https://github.com/FalkorDB/GraphRAG-SDK/blob/v1.4.0/graphrag_sdk/src/graphrag_sdk/core/models.py)
10. [v1.4.0 extraction implementation and failure behavior](https://github.com/FalkorDB/GraphRAG-SDK/blob/v1.4.0/graphrag_sdk/src/graphrag_sdk/ingestion/extraction_strategies/graph_extraction.py)
11. [v1.4.0 PDF loader](https://github.com/FalkorDB/GraphRAG-SDK/blob/v1.4.0/graphrag_sdk/src/graphrag_sdk/ingestion/loaders/pdf_loader.py)
12. [Sentence-transformers MiniLM model card](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2)
13. [v1.4.0 ontology persistence](https://github.com/FalkorDB/GraphRAG-SDK/blob/v1.4.0/graphrag_sdk/src/graphrag_sdk/storage/ontology_store.py)
14. [v0.8.1 legacy KnowledgeGraph examples and format list](https://github.com/FalkorDB/GraphRAG-SDK/blob/v0.8.1/README.md)
15. [Current upstream README: legacy pin and newer examples (moving branch)](https://github.com/FalkorDB/GraphRAG-SDK/blob/main/README.md)
16. [Groq OpenAI compatibility](https://console.groq.com/docs/openai)
17. [v1.4.0 ingestion pipeline: provenance and persistence](https://github.com/FalkorDB/GraphRAG-SDK/blob/v1.4.0/graphrag_sdk/src/graphrag_sdk/ingestion/pipeline.py)
18. [v1.4.0 multi-path result assembly](https://github.com/FalkorDB/GraphRAG-SDK/blob/v1.4.0/graphrag_sdk/src/graphrag_sdk/retrieval/strategies/result_assembly.py)
