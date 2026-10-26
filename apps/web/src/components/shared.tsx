import { isValidElement, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import mermaid from 'mermaid';
import type { Status, Priority } from '../../../../packages/contracts/index.ts';
import { useLocale } from '../lib/locale';
export const statusNames:Record<Status,string>={backlog:'待规划',todo:'待办',in_progress:'进行中',in_review:'待验收',blocked:'阻塞',done:'已完成',canceled:'已取消'};
export const priorityNames:Record<Priority,string>={none:'无优先级',urgent:'紧急',high:'高',medium:'中',low:'低'};
export function StatusDot({status}:{status:Status}) { return <span className={`status-dot ${status}`} aria-label={statusNames[status]}/>; }
function MermaidBlock({ source }: { source: string }) {
 const ref = useRef<HTMLDivElement>(null); const reactId = useId(); const [failed, setFailed] = useState(false);
 useEffect(() => { let active = true; setFailed(false); const id = `mermaid-${reactId.replaceAll(':', '')}`; mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'neutral' }); void mermaid.render(id, source).then(({ svg }) => { if (active && ref.current) ref.current.innerHTML = svg; }).catch(() => { if (active) setFailed(true); }); return () => { active = false; if (ref.current) ref.current.innerHTML = ''; }; }, [reactId, source]);
 return failed ? <pre className="mermaid-fallback"><code>{source}</code></pre> : <div ref={ref} className="mermaid-block" aria-label="Mermaid 图表" />;
}

/** Markdown images and attachment thumbnails open here instead of navigating away; Escape closes and focus returns. */
function ImageLightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
 const closeRef = useRef<HTMLButtonElement>(null);
 // Keep the latest close handler in a ref: the parent passes a fresh function each render, and depending on it
 // would re-run focus capture and restoration on every render, fighting the browser's focus.
 const onCloseRef = useRef(onClose);
 onCloseRef.current = onClose;
 useEffect(() => {
  const previous = document.activeElement as HTMLElement | null;
  closeRef.current?.focus();
  const onKey = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); onCloseRef.current(); } };
  window.addEventListener('keydown', onKey);
  return () => { window.removeEventListener('keydown', onKey); if (previous?.isConnected) previous.focus(); };
 }, []);
 // The overlay must live outside the markdown tree: an inline overlay would nest a block element inside the paragraph that holds the image.
 return createPortal(<div className="image-lightbox" role="dialog" aria-modal="true" aria-label={alt || '图片预览'} onClick={onClose}>
  <button ref={closeRef} className="icon-button lightbox-close" aria-label="关闭图片预览" onClick={onClose}><X size={18} /></button>
  <img src={src} alt={alt} onClick={(event) => event.stopPropagation()} />
  {alt ? <div className="lightbox-caption">{alt}</div> : null}
 </div>, document.body);
}

export function PreviewImage({ src, alt, className, ...props }: { src?: string; alt: string; className?: string } & Record<string, unknown>) {
 const [open, setOpen] = useState(false);
 if (!src) return <img loading="lazy" decoding="async" alt={alt} className={className} {...props} />;
 return <><button type="button" className="markdown-image" aria-label={alt ? `预览图片：${alt}` : '预览图片'} onClick={() => setOpen(true)}><img loading="lazy" decoding="async" alt={alt} className={className} src={src} {...props} /></button>{open && <ImageLightbox src={src} alt={alt} onClose={() => setOpen(false)} />}</>;
}

/** Attachment rows show a thumbnail for image files and fall back to the file link for everything else. */
export function AttachmentPreview({ src, filename, contentType }: { src: string; filename: string; contentType: string }) {
 const image = contentType.startsWith('image/');
 if (!image) return null;
 return <PreviewImage src={src} alt={filename} className="attachment-thumb" />;
}

export function Markdown({text}:{text:string}) { return <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{ pre: ({ children }) => { const child = Array.isArray(children) ? children[0] : children; return isValidElement(child) && child.type === MermaidBlock ? child : <pre>{children}</pre>; }, code: ({ children, className, ...props }) => { const language = /language-(\w+)/.exec(className ?? '')?.[1]; return language === 'mermaid' ? <MermaidBlock source={String(children).replace(/\n$/, '')} /> : <code className={className} {...props}>{children}</code>; }, a: ({ node: _node, children, ...props }) => <a target="_blank" rel="noreferrer" {...props}>{children}</a>, img: ({ node: _node, alt, src, ...props }) => <PreviewImage src={typeof src === 'string' ? src : undefined} alt={alt ?? ''} {...props} /> }}>{text}</ReactMarkdown></div>; }
export function Modal({title,children,onClose,wide=false}:{title:string;children:ReactNode;onClose:()=>void;wide?:boolean}) {
 const ref=useRef<HTMLDialogElement>(null);
 const reactId = useId();
 const titleId = `dialog-title-${reactId.replaceAll(':', '')}`;
 const { text } = useLocale();
 function trapFocus(event: ReactKeyboardEvent<HTMLDialogElement>) {
  if (event.key !== 'Tab') return;
  const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')].filter((element) => element.offsetParent !== null);
  if (!focusable.length) return;
  const first = focusable[0]; const last = focusable.at(-1); const active = document.activeElement;
  if (event.shiftKey && active === first) { event.preventDefault(); last?.focus(); }
  else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
 }
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null; const dialog = ref.current; if (dialog && !dialog.open) dialog.showModal(); const frame = window.requestAnimationFrame(() => dialog?.querySelector<HTMLElement>('[autofocus], button, input, textarea, select')?.focus()); return ()=>{window.cancelAnimationFrame(frame); if (previous?.isConnected) previous.focus(); else document.querySelector<HTMLElement>('.task-card')?.focus();};},[]);
 return <dialog ref={ref} className={wide?'modal wide':'modal'} onKeyDown={trapFocus} onCancel={e=>{e.preventDefault();onClose();}} onClick={e=>{if(e.target===e.currentTarget)onClose();}} aria-labelledby={titleId} aria-modal="true"><div className="modal-head"><h2 id={titleId}>{title}</h2><button className="icon-button" aria-label={text('关闭弹窗', 'Close dialog')} onClick={onClose}><X size={18}/></button></div>{children}</dialog>;
}
export function ErrorMessage({error}:{error:unknown}) {return error?<div className="error" role="alert">{error instanceof Error?error.message:String(error)}</div>:null;}
