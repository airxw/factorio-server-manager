// ============================================================================
// CodeEditor — 基于 CodeMirror 6 的代码编辑器组件
// 支持：语法高亮 / 行号 / 折叠 / 暗色主题 / 大文件保护 / Ctrl+S 保存快捷键
// ============================================================================

import { useEffect, useRef } from 'react';
import { Compartment, EditorState } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { LanguageSupport, StreamLanguage } from '@codemirror/language';
import { basicSetup } from 'codemirror';
import { oneDark } from '@codemirror/theme-one-dark';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { xml } from '@codemirror/lang-xml';
import { yaml } from '@codemirror/lang-yaml';
import { properties } from '@codemirror/legacy-modes/mode/properties';
import type { EditorLanguage } from '../utils/language-detect';

export interface CodeEditorProps {
  value: string;
  language: EditorLanguage;
  onChange?: (value: string) => void;
  onSave?: () => void;
  readOnly?: boolean;
  fontSize?: number;
}

/** 大文件保护阈值：超过 2MB 不渲染编辑器 */
const MAX_FILE_SIZE = 2 * 1024 * 1024;

/** 根据语言返回对应的 CodeMirror 语言扩展 */
function getLanguageExtension(language: EditorLanguage): Extension[] {
  switch (language) {
    case 'json':
      return [json()];
    case 'yaml':
      return [yaml()];
    case 'ini':
      // properties/ini/conf/toml 等键值对格式：使用 legacy-modes 的 properties 流模式
      return [new LanguageSupport(StreamLanguage.define(properties))];
    case 'markdown':
      return [markdown()];
    case 'xml':
      return [xml()];
    case 'shell':
    case 'plaintext':
    default:
      return [];
  }
}

export default function CodeEditor({
  value,
  language,
  onChange,
  onSave,
  readOnly = false,
  fontSize = 13,
}: CodeEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const langCompartment = useRef(new Compartment());
  const readOnlyCompartment = useRef(new Compartment());
  const themeCompartment = useRef(new Compartment());

  // 用 ref 持有最新回调，避免回调变化导致编辑器重建
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  useEffect(() => {
    onChangeRef.current = onChange;
    onSaveRef.current = onSave;
  });

  const isLargeFile = value.length > MAX_FILE_SIZE;

  // 创建/销毁编辑器实例（大文件时不创建）
  useEffect(() => {
    if (isLargeFile || !hostRef.current) return;

    const view = new EditorView({
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          keymap.of([
            {
              key: 'Mod-s',
              preventDefault: true,
              run: () => {
                onSaveRef.current?.();
                return true;
              },
            },
          ]),
          langCompartment.current.of(getLanguageExtension(language)),
          readOnlyCompartment.current.of(EditorState.readOnly.of(readOnly)),
          themeCompartment.current.of(
            EditorView.theme({
              '&': { fontSize: `${fontSize}px` },
              '.cm-scroller': { minHeight: '320px', maxHeight: '70vh' },
            }),
          ),
          oneDark,
          EditorView.updateListener.of((u) => {
            if (u.docChanged) {
              onChangeRef.current?.(u.state.doc.toString());
            }
          }),
        ],
      }),
      parent: hostRef.current,
    });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // 仅在跨越「大文件阈值」时重建编辑器；其余变化通过下面的 effect 增量同步
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLargeFile]);

  // 外部 value 变化时同步到编辑器（与用户正在输入的内容一致时不覆盖，避免光标跳动）
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
    }
  }, [value]);

  // 语言切换：通过 compartment 重新配置，无需重建编辑器
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: langCompartment.current.reconfigure(getLanguageExtension(language)),
    });
  }, [language]);

  // 只读状态切换
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: readOnlyCompartment.current.reconfigure(EditorState.readOnly.of(readOnly)),
    });
  }, [readOnly]);

  // 字号切换
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: themeCompartment.current.reconfigure(
        EditorView.theme({
          '&': { fontSize: `${fontSize}px` },
          '.cm-scroller': { minHeight: '320px', maxHeight: '70vh' },
        }),
      ),
    });
  }, [fontSize]);

  if (isLargeFile) {
    return (
      <div className="alert alert-error">
        文件过大（{(value.length / 1024 / 1024).toFixed(1)}MB），已超过 2MB 限制，请下载后查看。
      </div>
    );
  }

  return (
    <div
      ref={hostRef}
      className="code-editor-host"
      style={{
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius)',
        overflow: 'hidden',
      }}
    />
  );
}
