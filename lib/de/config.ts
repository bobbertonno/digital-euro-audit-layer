import 'server-only'

export const config = {
  mongoUri: process.env.MONGODB_URI || '',
  database: process.env.MONGODB_DATABASE || 'digital_euro_demo',
  demoMode: process.env.DEMO_MODE !== 'false',
  adminToken: process.env.DEMO_ADMIN_TOKEN || '',
  embeddingModel: process.env.EMBEDDING_MODEL || 'openai/text-embedding-3-small',
  embeddingDimensions: Number(process.env.EMBEDDING_DIMENSIONS || 256),
  searchIndexName: process.env.ATLAS_SEARCH_INDEX || 'de_text',
  vectorIndexName: process.env.ATLAS_VECTOR_INDEX || 'de_vector',
}

export const isAtlasConfigured = () => Boolean(config.mongoUri)

/** Reset/seed may only ever touch a dedicated demo database. */
export function assertDemoDatabase() {
  if (!/demo/i.test(config.database)) {
    throw new Error(`Refusing destructive operation: database "${config.database}" is not a dedicated demo database`)
  }
}
