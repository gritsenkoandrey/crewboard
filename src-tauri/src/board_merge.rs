//! Three-way merge prevents a stale GUI snapshot from erasing agent updates.
use crate::{board::{Board, validate}, CmdResult};
use serde_json::{Value, Map, json};
use std::collections::{BTreeMap, BTreeSet, HashSet};
const COLS: [&str; 3] = ["todo", "inProgress", "done"];
fn conflict(path: &str) -> String { format!("Одновременное изменение {path}. Ваши правки сохранены в окне; обновите их после проверки актуальной доски.") }
fn value(base: &Value, local: &Value, remote: &Value, path: &str) -> CmdResult<Value> {
    if local == base { return Ok(remote.clone()); }
    if remote == base || local == remote { return Ok(local.clone()); }
    if path.ends_with("updatedAt") { return Ok(json!(local.as_u64().unwrap_or(0).max(remote.as_u64().unwrap_or(0)))); }
    if let (Some(b),Some(l),Some(r)) = (base.as_object(),local.as_object(),remote.as_object()) {
        let keys: BTreeSet<_> = b.keys().chain(l.keys()).chain(r.keys()).collect();
        let mut result = Map::new();
        for key in keys {
            let v = value(b.get(key).unwrap_or(&Value::Null), l.get(key).unwrap_or(&Value::Null), r.get(key).unwrap_or(&Value::Null), &format!("{path}.{key}"))?;
            if !v.is_null() { result.insert(key.clone(),v); }
        }
        return Ok(Value::Object(result));
    }
    Err(conflict(path))
}
fn tasks(board: &Value) -> BTreeMap<String, (String,Value)> {
    let mut result = BTreeMap::new();
    for col in COLS { for t in board[col].as_array().into_iter().flatten() {
        result.insert(t["id"].as_str().unwrap_or_default().into(),(col.into(),t.clone()));
    }} result
}
fn merge_labels(base: &Value, local: &Value, remote: &Value) -> CmdResult<Value> {
    fn by_id(v: &Value) -> BTreeMap<String,Value> { v.as_array().into_iter().flatten().map(|l|(l["id"].as_str().unwrap_or_default().into(),l.clone())).collect() }
    let b = by_id(&base["labels"]); let l = by_id(&local["labels"]); let r = by_id(&remote["labels"]);
    let ids: BTreeSet<_> = b.keys().chain(l.keys()).chain(r.keys()).collect();
    let mut items = BTreeMap::new();
    for id in ids {
        let v = value(b.get(id).unwrap_or(&Value::Null),l.get(id).unwrap_or(&Value::Null),r.get(id).unwrap_or(&Value::Null),"метки")?;
        if !v.is_null() { items.insert(id.clone(),v); }
    }
    let mut ordered = Vec::new();
    for label in remote["labels"].as_array().into_iter().flatten().chain(local["labels"].as_array().into_iter().flatten()) {
        if let Some(v) = items.remove(label["id"].as_str().unwrap_or_default()) { ordered.push(v); }
    }
    Ok(json!(ordered))
}
pub(crate) fn merge(base: &Board, local: &Board, remote: &Board) -> CmdResult<Board> {
    let b = serde_json::to_value(base).map_err(|e|e.to_string())?;
    let l = serde_json::to_value(local).map_err(|e|e.to_string())?;
    let mut r = serde_json::to_value(remote).map_err(|e|e.to_string())?;
    let bt = tasks(&b); let lt = tasks(&l); let rt = tasks(&r);
    let ids: BTreeSet<_> = bt.keys().chain(lt.keys()).chain(rt.keys()).collect();
    let mut next = r["nextTaskNumber"].as_u64().unwrap_or(1).max(1);
    let mut merged = BTreeMap::new();
    for id in ids {
        let entry = match (bt.get(id),lt.get(id),rt.get(id)) {
            (Some(base),Some(local),Some(remote)) => {
                let col = value(&json!(base.0),&json!(local.0),&json!(remote.0),"статуса задачи")?.as_str().unwrap().to_string();
                let mut task = value(&base.1,&local.1,&remote.1,&format!("задачи {id}"))?;
                if remote.1["claim"].is_object() && local.1["assigneeId"] != base.1["assigneeId"] && local.1["assigneeId"] != remote.1["assigneeId"] {
                    return Err("Сначала освободите задачу, занятую сессией агента".into());
                }
                if remote.1["claim"].is_object() && local.1["archived"] != base.1["archived"] { return Err("Сначала освободите задачу перед архивированием".into()); }
                if col == "done" && base.0 != "done" { task.as_object_mut().unwrap().remove("claim"); task["readyForReview"] = json!(false); task.as_object_mut().unwrap().remove("question"); }
                Some((col,task))
            },
            (Some(base),None,Some(remote)) => {
                if base != remote || remote.1["claim"].is_object() { return Err(conflict("удаляемой задачи")); } None
            },
            (Some(base),Some(local),None) => { if local != base { return Err(conflict("удалённой задачи")); } None },
            (None,Some(local),None) => {
                let mut task = local.1.clone(); task["number"] = json!(next); next += 1; Some((local.0.clone(),task))
            },
            (None,Some(local),Some(remote)) => { if local != remote { return Err(conflict("новой задачи")); } Some(remote.clone()) },
            (_,None,Some(remote)) => Some(remote.clone()),
            _ => None,
        };
        if let Some(entry) = entry { merged.insert(id.clone(),entry); }
    }
    for col in COLS {
        let order = |v: &Value| -> Vec<String> { v[col].as_array().into_iter().flatten().filter_map(|t|t["id"].as_str().map(str::to_owned)).collect() };
        let local_order = order(&l); let base_order = order(&b); let remote_order = order(&r);
        let primary = if local_order != base_order { &local_order } else { &remote_order };
        let mut emitted = HashSet::new(); let mut list = Vec::new();
        for id in primary.iter().chain(remote_order.iter()).chain(local_order.iter()) {
            if let Some((target,task)) = merged.get(id) { if target == col && emitted.insert(id) { list.push(task.clone()); } }
        }
        r[col] = json!(list);
    }
    r["labels"] = merge_labels(&b,&l,&r)?;
    r["taskPrefix"] = value(&b["taskPrefix"],&l["taskPrefix"],&r["taskPrefix"],"префикса проекта")?;
    r["nextTaskNumber"] = json!(next.max(l["nextTaskNumber"].as_u64().unwrap_or(1)));
    validate(serde_json::from_value(r).map_err(|e| e.to_string())?)
}

#[cfg(test)] mod tests {
    use super::*;
    fn board(v:Value)->Board { serde_json::from_value(v).unwrap() }
    fn base()->Value {json!({"taskPrefix":"TT","nextTaskNumber":2,"todo":[{"id":"a","title":"Task","number":1}],"inProgress":[],"done":[],"labels":[]})}
    #[test] fn gui_edit_preserves_claim_and_agent_report() {
        let base=base();let mut local=base.clone();let mut remote=base.clone();
        local["todo"][0]["description"]=json!("New description");
        let mut task=remote["todo"].as_array_mut().unwrap().remove(0);
        task["claim"]=json!({"sessionId":"s","token":"t","assigneeId":"codex","startedAt":1});
        task["reports"]=json!([{"text":"Done","authorId":"codex","sessionId":"s","createdAt":2}]);
        remote["inProgress"]=json!([task]);
        let merged=serde_json::to_value(merge(&board(base),&board(local),&board(remote)).unwrap()).unwrap();
        assert!(merged["todo"].as_array().unwrap().is_empty());
        assert_eq!(merged["inProgress"][0]["description"],"New description");
        assert_eq!(merged["inProgress"][0]["claim"]["sessionId"],"s");
        assert_eq!(merged["inProgress"][0]["reports"][0]["text"],"Done");
    }
    #[test] fn conflicting_edits_and_delete_of_claimed_task_are_rejected() {
        let base=base();let mut local=base.clone();let mut remote=base.clone();
        local["todo"][0]["title"]=json!("Local");remote["todo"][0]["title"]=json!("Remote");
        assert!(merge(&board(base.clone()),&board(local),&board(remote)).is_err());
        let mut remote=base.clone();remote["todo"][0]["claim"]=json!({"sessionId":"s"});
        let mut local=base.clone();local["todo"]=json!([]);
        assert!(merge(&board(base),&board(local),&board(remote)).is_err());
    }
    #[test] fn concurrent_creation_uses_unique_numbers_and_queued_edits_preserve_them() {
        let base=base();let mut remote=base.clone();let mut local=base.clone();
        remote["todo"].as_array_mut().unwrap().push(json!({"id":"agent","title":"Agent task","number":2}));remote["nextTaskNumber"]=json!(3);
        local["todo"].as_array_mut().unwrap().push(json!({"id":"gui","title":"GUI task","number":2}));local["nextTaskNumber"]=json!(3);
        let merged=merge(&board(base.clone()),&board(local.clone()),&board(remote)).unwrap();
        let mut next=local.clone();next["todo"][1]["title"]=json!("Edited GUI task");
        let result=serde_json::to_value(merge(&board(local),&board(next),&merged).unwrap()).unwrap();
        let tasks=result["todo"].as_array().unwrap();
        assert_eq!(tasks.len(),3);
        assert_eq!(tasks.iter().find(|t|t["id"]=="gui").unwrap()["number"],3);
        assert_eq!(tasks.iter().find(|t|t["id"]=="agent").unwrap()["number"],2);
        assert_eq!(result["nextTaskNumber"],4);
    }
    #[test] fn human_done_clears_session_but_keeps_results() {
        let mut base=base();let mut task=base["todo"].as_array_mut().unwrap().remove(0);
        task["claim"]=json!({"sessionId":"s"});task["readyForReview"]=json!(true);task["reports"]=json!([{"text":"Result"}]);
        base["inProgress"]=json!([task.clone()]);let mut local=base.clone();local["inProgress"]=json!([]);local["done"]=json!([task]);
        let result=serde_json::to_value(merge(&board(base.clone()),&board(local),&board(base)).unwrap()).unwrap();
        assert!(result["done"][0]["claim"].is_null());assert_eq!(result["done"][0]["readyForReview"],false);assert_eq!(result["done"][0]["reports"][0]["text"],"Result");
    }
}
