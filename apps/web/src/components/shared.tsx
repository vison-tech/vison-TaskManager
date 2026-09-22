import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Status, Priority } from '../../../../packages/contracts/index.ts';
export const statusNames:Record<Status,string>={backlog:'待规划',todo:'待办',in_progress:'进行中',in_review:'待验收',blocked:'阻塞',done:'已完成',canceled:'已取消'};
export const priorityNames:Record<Priority,string>={none:'无优先级',urgent:'紧急',high:'高',medium:'中',low:'低'};
export function StatusDot({status}:{status:Status}) { return <span className={`status-dot ${status}`} aria-label={statusNames[status]}/>; }
export function Markdown({text}:{text:string}) {return <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown></div>;}
export function Modal({title,children,onClose,wide=false}:{title:string;children:ReactNode;onClose:()=>void;wide?:boolean}) {
 const ref=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null;ref.current?.showModal();return ()=>{previous?.focus();};},[]);
 return <dialog ref={ref} className={wide?'modal wide':'modal'} onCancel={e=>{e.preventDefault();onClose();}} onClick={e=>{if(e.target===e.currentTarget)onClose();}} aria-labelledby="dialog-title"><div className="modal-head"><h2 id="dialog-title">{title}</h2><button className="icon-button" aria-label="关闭弹窗" onClick={onClose}><X size={18}/></button></div>{children}</dialog>;
}
export function ErrorMessage({error}:{error:unknown}) {return error?<div className="error" role="alert">{error instanceof Error?error.message:String(error)}</div>:null;}
