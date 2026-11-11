import { useEffect, useState } from "react";
import { createParticipant, getParticipants } from "../api";
import type { Participant } from "../types";
import Icon from "./Icon";
export default function AgentSettings({ onClose }: { onClose: () => void }) {
  const [list,setList]=useState<Participant[]>([]);
  const [name,setName]=useState("");const [kind,setKind]=useState("agent");
  const [busy,setBusy]=useState(false);const [error,setError]=useState<string|null>(null);
  useEffect(()=>{let alive=true;getParticipants().then(v=>{if(alive)setList(v);},e=>{if(alive)setError(String(e));});return()=>{alive=false;};},[]);
  return <div className="overlay" onMouseDown={()=>!busy&&onClose()}><form className="dialog agent-settings" role="dialog" aria-modal="true" aria-labelledby="participants-title"
    onMouseDown={e=>e.stopPropagation()} onKeyDown={e=>{if(e.key==="Escape"&&!busy){e.stopPropagation();onClose();}}}
    onSubmit={e=>{e.preventDefault();if(!name.trim()||busy)return;setBusy(true);setError(null);void createParticipant(name.trim(),kind).then(v=>{setList(v);setName("");},e=>setError(String(e))).finally(()=>setBusy(false));}}>
    <header className="archive-heading"><h2 id="participants-title">Исполнители</h2><button type="button" className="icon-btn" aria-label="Закрыть исполнителей" disabled={busy} onClick={onClose}><Icon name="close" /></button></header>
    <p className="muted small">Общий список для всех проектов в выбранной папке данных.</p>
    <div className="participant-list">{list.map(p=><div key={p.id}><strong>{p.name}</strong><span className="muted small">{p.kind==="agent"?"Агент":"Человек"} · <code>{p.id}</code></span></div>)}</div>
    <div className="participant-create"><input autoFocus className="inline-input" aria-label="Имя исполнителя" placeholder="Новый исполнитель" maxLength={60} value={name} disabled={busy} onChange={e=>setName(e.target.value)} />
      <select aria-label="Тип исполнителя" value={kind} disabled={busy} onChange={e=>setKind(e.target.value)}><option value="agent">Агент</option><option value="human">Человек</option></select>
      <button className="btn primary" disabled={busy||!name.trim()}>Добавить</button></div>
    {error&&<p className="error" role="alert">{error}</p>}
    <p className="muted small">Назначение задачи не запускает агента. Задание нужно передать в его чат вручную.</p>
  </form></div>;
}
