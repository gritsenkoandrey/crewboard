import { useI18n } from "../i18n";
import { useEffect, useState } from "react";
import { createParticipant, getParticipants } from "../api";
import type { Participant } from "../types";
import Icon from "./Icon";
export default function AgentSettings({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const [list,setList]=useState<Participant[]>([]);
  const [name,setName]=useState("");const [kind,setKind]=useState("agent");
  const [busy,setBusy]=useState(false);const [error,setError]=useState<string|null>(null);
  useEffect(()=>{let alive=true;getParticipants().then(v=>{if(alive)setList(v);},e=>{if(alive)setError(String(e));});return()=>{alive=false;};},[]);
  return <div className="overlay" onMouseDown={()=>!busy&&onClose()}><form className="dialog agent-settings" role="dialog" aria-modal="true" aria-labelledby="participants-title"
    onMouseDown={e=>e.stopPropagation()} onKeyDown={e=>{if(e.key==="Escape"&&!busy){e.stopPropagation();onClose();}}}
    onSubmit={e=>{e.preventDefault();if(!name.trim()||busy)return;setBusy(true);setError(null);void createParticipant(name.trim(),kind).then(v=>{setList(v);setName("");},e=>setError(String(e))).finally(()=>setBusy(false));}}>
    <header className="archive-heading"><h2 id="participants-title">{t("Participants")}</h2><button type="button" className="icon-btn" aria-label={t("Close participants")} disabled={busy} onClick={onClose}><Icon name="close" /></button></header>
    <p className="muted small">{t("Shared across all projects in the selected data folder.")}</p>
    <div className="participant-list">{list.map(p=><div key={p.id}><strong>{p.name}</strong><span className="muted small">{p.kind==="agent"?t("Agent"):t("Human")} · <code>{p.id}</code></span></div>)}</div>
    <div className="participant-create"><input autoFocus className="inline-input" aria-label={t("Participant name")} placeholder={t("New participant")} maxLength={60} value={name} disabled={busy} onChange={e=>setName(e.target.value)} />
      <select aria-label={t("Participant type")} value={kind} disabled={busy} onChange={e=>setKind(e.target.value)}><option value="agent">{t("Agent")}</option><option value="human">{t("Human")}</option></select>
      <button className="btn primary" disabled={busy||!name.trim()}>{t("Add")}</button></div>
    {error&&<p className="error" role="alert">{error}</p>}
    <p className="muted small">{t("Assigning a task does not start an agent. Send the instructions to its chat manually.")}</p>
  </form></div>;
}
