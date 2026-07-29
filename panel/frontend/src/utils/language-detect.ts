// ============================================================================
// language-detect — 根据文件名推断编辑器语言模式
// 用于 CodeEditor 选择对应的 CodeMirror 语言包（语法高亮）
// ============================================================================

export type EditorLanguage = 'json' | 'yaml' | 'ini' | 'markdown' | 'xml' | 'shell' | 'plaintext';

const EXT_LANGUAGE_MAP: Record<string, EditorLanguage> = {
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  properties: 'ini',
  ini: 'ini',
  conf: 'ini',
  config: 'ini',
  toml: 'ini',
  txt: 'plaintext',
  md: 'markdown',
  markdown: 'markdown',
  xml: 'xml',
  sh: 'shell',
  bash: 'shell',
};

/** 根据文件名扩展名推断编辑器语言；未命中时降级为 plaintext */
export function detectLanguage(filename: string): EditorLanguage {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return EXT_LANGUAGE_MAP[ext] ?? 'plaintext';
}
