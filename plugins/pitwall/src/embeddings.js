import { pipeline, AutoTokenizer, AutoModelForSequenceClassification } from '@huggingface/transformers';

const BGE_QUERY = 'Represent this sentence for searching relevant passages: ';
export const MODELS = {
  'Xenova/bge-small-en-v1.5': { pooling: 'cls', queryPrefix: BGE_QUERY, docPrefix: '' },
  'Xenova/all-MiniLM-L6-v2': { pooling: 'mean', queryPrefix: '', docPrefix: '' },
  'Snowflake/snowflake-arctic-embed-s': { pooling: 'cls', queryPrefix: BGE_QUERY, docPrefix: '' },
};
const RERANKER_ID = 'Xenova/ms-marco-MiniLM-L-6-v2';
const quiet = { dtype: 'q8', progress_callback: () => {} };

/** Returns an embedder bound to one model; the model loads lazily on first use. */
export function createEmbedder(modelId) {
  const cfg = MODELS[modelId] || { pooling: 'mean', queryPrefix: '', docPrefix: '' };
  let pipe = null;
  const load = () => (pipe ??= pipeline('feature-extraction', modelId, quiet));
  const run = async texts => {
    const out = await (await load())(texts.map(t => t.slice(0, 10_000)), { pooling: cfg.pooling, normalize: true });
    const dim = out.dims[1];
    return texts.map((_, i) => Float32Array.from(out.data.subarray(i * dim, (i + 1) * dim)));
  };
  return {
    modelId,
    warm: load,
    embedDocs: texts => run(texts.map(t => cfg.docPrefix + t)),
    embedQuery: async text => (await run([cfg.queryPrefix + text]))[0],
  };
}

/** Returns a cross-encoder scorer: logits (higher = more relevant) for query/passage pairs in one batch. */
export function createReranker() {
  let loaded = null;
  const load = () => (loaded ??= Promise.all([
    AutoTokenizer.from_pretrained(RERANKER_ID),
    AutoModelForSequenceClassification.from_pretrained(RERANKER_ID, quiet),
  ]));
  return {
    warm: load,
    async score(query, passages) {
      if (!passages.length) return [];
      const [tok, model] = await load();
      const inputs = tok(passages.map(() => query), { text_pair: passages, padding: true, truncation: true });
      const { logits } = await model(inputs);
      return Array.from({ length: passages.length }, (_, i) => logits.data[i]);
    },
  };
}
