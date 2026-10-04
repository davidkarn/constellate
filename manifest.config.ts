import { defineManifest } from '@crxjs/vite-plugin'
import pkg from './package.json' with { type: 'json' }

export default defineManifest({
  manifest_version: 3,
  name: 'Constellate',
  version: pkg.version,
  description: 'Constellate Chrome extension',
  icons: {
    128: 'public/icons/icon128.png',
  },
  action: {
    default_popup: 'src/popup/index.html',
  },
  options_ui: {
    page: 'src/options/index.html',
    open_in_tab: true,
  },
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },
  content_scripts: [
    {
      matches: ['<all_urls>'],
      js: ['src/content/index.ts'],
    },
    {
      matches: ['https://www.youtube.com/*'],
      js: ['src/content/youtube.ts'],
    },
  ],
  permissions: ['storage'],
  host_permissions: ['https://openrouter.ai/*'],
})
