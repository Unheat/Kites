/**
 * On-demand loader map for hypher 0.1.8 trie data (48 languages).
 * Each language is a separate dynamic-import chunk so no eager all-language bundle.
 * A static import map keeps Vite/MV3 CSP and Node/tsx both working.
 * Source: typst/hypher commit d81cc506 (crates.io hypher 0.1.8).
 * Pattern licenses: see ../hypherData/licenses and ../hypherData/patterns.
 */

export type HypherTrieLoader = () => Promise<{ default: string }>;

export const HYPHER_TRIE_LOADERS: Record<string, HypherTrieLoader> = {
  "af": () => import('./tries/af'),
  "as": () => import('./tries/as'),
  "be": () => import('./tries/be'),
  "bg": () => import('./tries/bg'),
  "bn": () => import('./tries/bn'),
  "ca": () => import('./tries/ca'),
  "cs": () => import('./tries/cs'),
  "da": () => import('./tries/da'),
  "de": () => import('./tries/de'),
  "el": () => import('./tries/el'),
  "en": () => import('./tries/en'),
  "es": () => import('./tries/es'),
  "et": () => import('./tries/et'),
  "fi": () => import('./tries/fi'),
  "fr": () => import('./tries/fr'),
  "gl": () => import('./tries/gl'),
  "gu": () => import('./tries/gu'),
  "hi": () => import('./tries/hi'),
  "hr": () => import('./tries/hr'),
  "hu": () => import('./tries/hu'),
  "is": () => import('./tries/is'),
  "it": () => import('./tries/it'),
  "ka": () => import('./tries/ka'),
  "kn": () => import('./tries/kn'),
  "ku": () => import('./tries/ku'),
  "la": () => import('./tries/la'),
  "lt": () => import('./tries/lt'),
  "ml": () => import('./tries/ml'),
  "mn": () => import('./tries/mn'),
  "mr": () => import('./tries/mr'),
  "nl": () => import('./tries/nl'),
  "no": () => import('./tries/no'),
  "or": () => import('./tries/or'),
  "pa": () => import('./tries/pa'),
  "pl": () => import('./tries/pl'),
  "pt": () => import('./tries/pt'),
  "ru": () => import('./tries/ru'),
  "sa": () => import('./tries/sa'),
  "sk": () => import('./tries/sk'),
  "sl": () => import('./tries/sl'),
  "sq": () => import('./tries/sq'),
  "sr": () => import('./tries/sr'),
  "sv": () => import('./tries/sv'),
  "ta": () => import('./tries/ta'),
  "te": () => import('./tries/te'),
  "tk": () => import('./tries/tk'),
  "tr": () => import('./tries/tr'),
  "uk": () => import('./tries/uk'),
};

export const HYPHER_TRIE_LANGUAGES = Object.keys(HYPHER_TRIE_LOADERS);
