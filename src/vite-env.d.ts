/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_WPS_DOC_URL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
