use crate::{CmdResult, board, storage, write_atomic};
use serde::{Serialize, Deserialize};
use serde_json::{Value,json};
use std::path::{Path,PathBuf};
use std::fs;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

#[derive(Clone,Serialize,Deserialize,Debug)]
#[serde(rename_all="camelCase")]
pub struct Participant { pub id: String, pub name: String, pub kind: String }
pub(crate) fn now() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64 }
pub(crate) fn unique() -> String { format!("{:x}-{:x}", SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos(),std::process::id()) }
pub(crate) fn participants(root: &Path) -> CmdResult<Vec<Participant>> {
    let _lock=storage::lock(root,"participants.lock")?;
    match fs::read_to_string(root.join("participants.json")) {
        Ok(text)=>serde_json::from_str(&text).map_err(|e|format!("Повреждён список исполнителей: {e}")),
        Err(e) if e.kind()==std::io::ErrorKind::NotFound=> {
            let list=vec![Participant{id:"you".into(),name:"Я".into(),kind:"human".into()},Participant{id:"codex".into(),name:"Codex".into(),kind:"agent".into()},Participant{id:"claude".into(),name:"Claude".into(),kind:"agent".into()}];
            write_atomic(&root.join("participants.json"),&serde_json::to_string_pretty(&list).map_err(|e|e.to_string())?)?; Ok(list)
        }, Err(e)=>Err(e.to_string())
    }
}
pub(crate) fn add_participant(root: &Path,name:&str,kind:&str)->CmdResult<Vec<Participant>> {
    let _=participants(root)?;
    let _lock=storage::lock(root,"participants.lock")?;
    let name=name.trim();
    if name.is_empty() || name.chars().count()>60 || !["human","agent"].contains(&kind) {return Err("Укажите имя до 60 символов и тип human или agent".into());}
    let mut list:Vec<Participant>=serde_json::from_str(&fs::read_to_string(root.join("participants.json")).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
    if list.iter().any(|p|p.name.to_lowercase()==name.to_lowercase()){return Err("Исполнитель с таким именем уже есть".into());}
    list.push(Participant{id:format!("member-{}",unique()),name:name.into(),kind:kind.into()});
    write_atomic(&root.join("participants.json"),&serde_json::to_string_pretty(&list).map_err(|e|e.to_string())?)?; Ok(list)
}
pub(crate) fn project_dir(root:&Path,id:&str)->CmdResult<PathBuf>{
    if id.is_empty() || id=="." || id==".." || id.contains(['/', '\\', ':']) {return Err("Некорректный проект".into());}
    let dir=root.join("projects").join(id);
    if !dir.is_dir(){return Err(format!("Проект не найден: {id}"));}
    let real=fs::canonicalize(&dir).map_err(|e|e.to_string())?;
    if real.parent()!=Some(fs::canonicalize(root.join("projects")).map_err(|e|e.to_string())?.as_path()){return Err("Папка проекта находится вне данных".into());}
    Ok(dir)
}
pub(crate) fn source(dir:&Path)->CmdResult<Option<String>> {
    let meta:Value=serde_json::from_str(&fs::read_to_string(dir.join("project.json")).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
    Ok(meta["sourceDir"].as_str().map(str::to_owned))
}
pub(crate) fn set_source(dir:&Path,path:Option<String>)->CmdResult<Option<String>> {
    if let Some(ref path)=path {if !Path::new(path).is_absolute() || !Path::new(path).is_dir(){return Err("Папка исходников не найдена".into());}}
    let _lock=storage::lock(dir,"project.lock")?;
    let mut meta:Value=serde_json::from_str(&fs::read_to_string(dir.join("project.json")).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
    meta["sourceDir"]=json!(path);
    write_atomic(&dir.join("project.json"),&serde_json::to_string_pretty(&meta).map_err(|e|e.to_string())?)?; Ok(path)
}
pub(crate) fn participant(root:&Path,id:&str)->CmdResult<Participant>{ participants(root)?.into_iter().find(|p|p.id==id).ok_or_else(||format!("Исполнитель не найден: {id}")) }
#[tauri::command]
pub fn get_participants(app:AppHandle)->CmdResult<Vec<Participant>>{participants(&crate::data_dir(&app)?)}
#[tauri::command]
pub fn create_participant(app:AppHandle,name:String,kind:String)->CmdResult<Vec<Participant>>{add_participant(&crate::data_dir(&app)?,&name,&kind)}
#[tauri::command]
pub fn get_source_dir(app:AppHandle,id:String)->CmdResult<Option<String>>{source(&crate::projects::project_dir(&app,&id)?)}
#[tauri::command]
pub fn set_source_dir(app:AppHandle,id:String,path:Option<String>)->CmdResult<Option<String>>{set_source(&crate::projects::project_dir(&app,&id)?,path)}
#[tauri::command]
pub fn release_task(app:AppHandle,id:String,task_id:String)->CmdResult<board::Board>{
    let dir=crate::projects::project_dir(&app,&id)?;
    transact(&dir,|v|{
        for col in ["todo","inProgress","done"] {
            let index=v[col].as_array().unwrap().iter().position(|t|t["id"]==task_id);
            if let Some(index)=index {
                let task=&mut v[col][index];
                task.as_object_mut().unwrap().remove("claim"); task["readyForReview"]=json!(false); task.as_object_mut().unwrap().remove("question"); task["updatedAt"]=json!(now());
                if col!="todo" && col!="done" {let task=v[col].as_array_mut().unwrap().remove(index);v["todo"].as_array_mut().unwrap().push(task);}
                return Ok(());
            }
        }
        Err("Задача не найдена".into())
    })
}
pub(crate) fn transact(dir:&Path,action:impl FnOnce(&mut Value)->CmdResult<()>)->CmdResult<board::Board>{
    let _lock=storage::lock(dir,"board.lock")?;
    let mut data=serde_json::to_value(board::load(dir)?).map_err(|e|e.to_string())?;
    action(&mut data)?;
    let board=board::validate(serde_json::from_value(data).map_err(|e|e.to_string())?)?;
    board::store(dir,&board)?; Ok(board)
}
