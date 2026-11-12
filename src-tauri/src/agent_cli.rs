//! CLI for manually invoked agents; no background execution or network service.
use crate::{agents,board,storage,CmdResult};
use serde_json::{Value,json};
use std::{collections::BTreeMap,fs,path::{Path,PathBuf}};

const HELP:&str = r#"Crewboard agent CLI (JSON output)
  crewboard-cli [--data-dir PATH] projects list
  crewboard-cli [--data-dir PATH] projects set-source --project ID --path PATH
  crewboard-cli [--data-dir PATH] participants list
  crewboard-cli [--data-dir PATH] participants add --name NAME --kind human|agent
  crewboard-cli [--data-dir PATH] tasks list --project ID [--assignee ID] [--status todo|inProgress|done] [--label NAME] [--archived]
  crewboard-cli [--data-dir PATH] tasks show TT-24 [--project ID]
  crewboard-cli [--data-dir PATH] tasks create --project ID --title TITLE [--description-file PATH] [--criteria-file PATH] [--assignee ID] [--label NAME]
  crewboard-cli [--data-dir PATH] tasks claim TT-24 --session SESSION [--agent ID] [--project ID]
  crewboard-cli [--data-dir PATH] tasks report TT-24 --session SESSION --token TOKEN --file PATH|- [--project ID]
  crewboard-cli [--data-dir PATH] tasks ask TT-24 --session SESSION --token TOKEN --message TEXT [--project ID]
  crewboard-cli [--data-dir PATH] tasks submit TT-24 --session SESSION --token TOKEN [--project ID]
  crewboard-cli [--data-dir PATH] tasks release TT-24 --session SESSION --token TOKEN [--project ID]
  crewboard-cli [--data-dir PATH] tasks release TT-24 --force [--project ID]
claim returns a token. Keep it for report/ask/submit/release. --force is manual recovery.
claim without --agent uses the task's assignee; an unassigned task needs --agent.
--file - (and --description-file -/--criteria-file -) reads UTF-8 text from stdin; no temporary file needed.
No agent is launched by these commands. submit never moves a task to Done.
"#;
#[derive(Debug)]
struct Args { words:Vec<String>, flags:BTreeMap<String,String> }
impl Args {
    fn parse(args:Vec<String>)->CmdResult<Self>{
        let allowed=["data-dir","project","path","name","kind","assignee","agent","session","token","title","description-file","criteria-file","label","file","message","status","archived","force"];
        let mut words=Vec::new(); let mut flags=BTreeMap::new(); let mut args=args.into_iter();
        while let Some(arg)=args.next(){
            if let Some(key)=arg.strip_prefix("--") {
                if !allowed.contains(&key) || flags.contains_key(key){return Err(format!("Unknown or duplicate option: {arg}"));}
                let value=if ["archived","force"].contains(&key){"true".into()}else{args.next().filter(|s|!s.starts_with("--")).ok_or_else(||format!("Missing value for {arg}"))?};
                flags.insert(key.into(),value);
            }else{words.push(arg);}
        } Ok(Self{words,flags})
    }
    fn get(&self,key:&str)->Option<&str>{self.flags.get(key).map(String::as_str)}
    fn need(&self,key:&str)->CmdResult<&str>{self.get(key).filter(|s|!s.trim().is_empty()).ok_or_else(||format!("Specify --{key}"))}
}
fn data_root(args:&Args)->CmdResult<PathBuf>{
    let path=if let Some(path)=args.get("data-dir"){PathBuf::from(path)}else{
        let config=if cfg!(target_os="windows"){PathBuf::from(std::env::var("APPDATA").map_err(|_|"APPDATA is unavailable; specify --data-dir")?).join("com.local.tasktrack/config.json")}
        else{PathBuf::from(std::env::var("XDG_CONFIG_HOME").unwrap_or_else(|_|format!("{}/.config",std::env::var("HOME").unwrap_or_default()))).join("com.local.tasktrack/config.json")};
        let value:Value=serde_json::from_str(&fs::read_to_string(config).map_err(|_|"Crewboard settings not found; specify --data-dir")?).map_err(|e|e.to_string())?;
        PathBuf::from(value["dataDir"].as_str().ok_or("No data folder is selected in settings")?)
    };
    if !path.is_dir(){return Err("Data folder not found".into());} Ok(path)
}
fn projects(root:&Path)->CmdResult<Vec<Value>>{
    let mut list=Vec::new();
    for entry in fs::read_dir(root.join("projects")).map_err(|e|e.to_string())?{
        let entry=entry.map_err(|e|e.to_string())?;
        if !entry.file_type().map_err(|e|e.to_string())?.is_dir(){continue;}
        let id=entry.file_name().to_string_lossy().into_owned();
        if id.starts_with('.') {continue;}
        let dir=agents::project_dir(root,&id)?;
        let meta:Value=serde_json::from_str(&fs::read_to_string(dir.join("project.json")).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
        let _lock=storage::lock(&dir,"board.lock")?;
        let board=serde_json::to_value(board::load(&dir)?).map_err(|e|e.to_string())?;
        list.push(json!({"id":id,"name":meta["name"],"prefix":board["taskPrefix"],"sourceDir":meta["sourceDir"]}));
    }
    list.sort_by(|a,b|a["id"].as_str().cmp(&b["id"].as_str())); Ok(list)
}
fn resolve(root:&Path,args:&Args,code:&str)->CmdResult<(PathBuf,u64)>{
    let (prefix,num)=code.rsplit_once('-').ok_or("Specify a task code, for example TT-24")?;
    let number:u64=num.parse().map_err(|_|"Invalid task number")?;
    let candidates:Vec<Value>=projects(root)?.into_iter().filter(|p|p["prefix"].as_str().is_some_and(|s|s.eq_ignore_ascii_case(prefix)) && args.get("project").is_none_or(|id|p["id"]==id)).collect();
    if candidates.len()!=1{return Err("Project prefix not found or ambiguous. Specify --project with an ID from projects list".into());}
    Ok((agents::project_dir(root,candidates[0]["id"].as_str().unwrap())?,number))
}
fn columns()->[&'static str;3]{["todo","inProgress","done"]}
fn locate(v:&Value,number:u64)->CmdResult<(&'static str,usize)>{
    for col in columns(){if let Some(index)=v[col].as_array().unwrap().iter().position(|t|t["number"]==number){return Ok((col,index));}}
    Err("Task not found".into())
}
fn redact(mut task:Value)->Value{if let Some(claim)=task.get_mut("claim").and_then(Value::as_object_mut){claim.remove("token");}task}
fn view(dir:&Path,v:&Value,col:&str,t:&Value)->CmdResult<Value>{
    Ok(json!({"code":format!("{}-{}",v["taskPrefix"].as_str().unwrap_or(""),t["number"]),"status":col,"sourceDir":agents::source(dir)?,"task":redact(t.clone())}))
}
/// Text from a file, or from stdin when the path is "-" (so agents need no temporary file).
fn read_text(args:&Args,key:&str)->CmdResult<String>{
    let path=args.need(key)?;
    let bytes=if path=="-"{
        let mut buf=Vec::new();std::io::Read::read_to_end(&mut std::io::stdin(),&mut buf).map_err(|e|format!("Failed to read stdin for --{key}: {e}"))?;buf
    }else{fs::read(path).map_err(|e|format!("Failed to read --{key}: {e}"))?};
    decode_text(bytes,key)
}
fn decode_text(bytes:Vec<u8>,key:&str)->CmdResult<String>{
    let bytes=bytes.strip_prefix(b"\xEF\xBB\xBF").map(<[u8]>::to_vec).unwrap_or(bytes);
    let text=String::from_utf8(bytes).map_err(|_|format!("Text for --{key} must be UTF-8"))?;
    if text.chars().count()>200_000{return Err("Text exceeds 200000 characters".into());} Ok(text)
}
fn owner(task:&Value,args:&Args)->CmdResult<()>{
    if !task["claim"].is_object() || task["claim"]["token"]!=args.need("token")? || task["claim"]["sessionId"]!=args.need("session")? {
        return Err("Task is claimed by another session or has already been released".into());
    } Ok(())
}
fn move_task(v:&mut Value,from:&str,index:usize,to:&str){if from!=to{let task=v[from].as_array_mut().unwrap().remove(index);v[to].as_array_mut().unwrap().push(task);}}

pub fn execute(arguments:Vec<String>)->Result<Value,String>{
    let args=Args::parse(arguments)?;
    if args.words.len()<2{return Err(HELP.into());}
    let root=data_root(&args)?;
    let group=args.words[0].as_str();let action=args.words[1].as_str();
    if group=="projects" {return match action{
        "list"=>Ok(json!(projects(&root)?)),
        "set-source"=>Ok(json!({"sourceDir":agents::set_source(&agents::project_dir(&root,args.need("project")?)?,Some(args.need("path")?.into()))?})),
        _=>Err(HELP.into())
    };}
    if group=="participants" {return match action{
        "list"=>serde_json::to_value(agents::participants(&root)?).map_err(|e|e.to_string()),
        "add"=>serde_json::to_value(agents::add_participant(&root,args.need("name")?,args.need("kind")?)?).map_err(|e|e.to_string()),
        _=>Err(HELP.into())
    };}
    if group!="tasks"{return Err(HELP.into());}
    if action=="list"{
        let dir=agents::project_dir(&root,args.need("project")?)?;
        let _lock=storage::lock(&dir,"board.lock")?;let v=serde_json::to_value(board::load(&dir)?).map_err(|e|e.to_string())?;
        if args.get("status").is_some_and(|s|!columns().contains(&s)){return Err("Unknown status".into());}
        let mut result=Vec::new();
        for col in columns(){for task in v[col].as_array().unwrap(){
            if task["archived"]==true && args.get("archived").is_none(){continue;}
            if args.get("assignee").is_some_and(|id|task["assigneeId"]!=id) || args.get("status").is_some_and(|s|s!=col){continue;}
            if let Some(label)=args.get("label"){
                let ids:Vec<_>=v["labels"].as_array().unwrap().iter().filter(|l|l["id"]==label || l["name"].as_str().is_some_and(|s|s.eq_ignore_ascii_case(label))).map(|l|l["id"].clone()).collect();
                if !task["labels"].as_array().is_some_and(|labels|labels.iter().any(|id|ids.contains(id))){continue;}
            }
            result.push(view(&dir,&v,col,task)?);
        }}return Ok(json!(result));
    }
    if action=="create"{
        let dir=agents::project_dir(&root,args.need("project")?)?;
        let title=args.need("title")?.trim().to_string();
        if args.get("description-file")==Some("-") && args.get("criteria-file")==Some("-"){return Err("stdin (-) can only be used for one file".into());}
        let description=if args.get("description-file").is_some(){read_text(&args,"description-file")?}else{String::new()};
        let criteria=if args.get("criteria-file").is_some(){read_text(&args,"criteria-file")?}else{String::new()};
        if let Some(id)=args.get("assignee"){agents::participant(&root,id)?;}
        let task_id=format!("agent-{}",agents::unique());
        let result=agents::transact(&dir,|v|{
            let number=v["nextTaskNumber"].as_u64().unwrap_or(1);v["nextTaskNumber"]=json!(number+1);
            let mut labels=Vec::new();
            if let Some(label)=args.get("label"){
                let id=v["labels"].as_array().unwrap().iter().find(|l|l["id"]==label || l["name"].as_str().is_some_and(|s|s.eq_ignore_ascii_case(label))).ok_or("Label not found")?["id"].clone(); labels.push(id);
            }
            let mut task=json!({"id":task_id,"title":title,"number":number,"description":description,"acceptanceCriteria":criteria,"labels":labels,"updatedAt":agents::now()});
            if let Some(id)=args.get("assignee"){task["assigneeId"]=json!(id);}
            v["todo"].as_array_mut().unwrap().push(task);Ok(())
        })?;
        let v=serde_json::to_value(result).map_err(|e|e.to_string())?;
        let t=v["todo"].as_array().unwrap().iter().find(|t|t["id"]==task_id).unwrap();return view(&dir,&v,"todo",t);
    }
    let code=args.words.get(2).ok_or("Specify a task code")?;
    let (dir,number)=resolve(&root,&args,code)?;
    if action=="show"{
        let _lock=storage::lock(&dir,"board.lock")?;let v=serde_json::to_value(board::load(&dir)?).map_err(|e|e.to_string())?;
        let (col,index)=locate(&v,number)?;return view(&dir,&v,col,&v[col][index]);
    }
    // Without --agent, claim uses the task assignee; load participants before locking the board.
    let people=if action=="claim"{Some(agents::participants(&root)?)}else{None};
    if let (Some(people),Some(id))=(&people,args.get("agent")){if !people.iter().any(|p|p.id==id){return Err(format!("Participant not found: {id}"));}}
    let report=if action=="report"{Some(read_text(&args,"file")?)}else{None};
    if report.as_ref().is_some_and(|s|s.trim().is_empty()){return Err("Report cannot be empty".into());}
    let mut token=None;
    let result=agents::transact(&dir,|v|{
        let (col,index)=locate(v,number)?;
        let task=&mut v[col][index];
        if task["archived"]==true{return Err("Task is archived".into());}
        match action{
            "claim"=>{
                if col=="done"{return Err("Task is already done".into());}
                if task["claim"].is_object() || task["readyForReview"]==true{return Err("Task is already claimed or awaiting review".into());}
                let assignee=task["assigneeId"].as_str().filter(|id|!id.is_empty());
                let agent_id=match (args.get("agent"),assignee){
                    (Some(id),Some(current)) if id!=current=>return Err(format!("Task is assigned to {current}. Specify --agent {current} or omit --agent")),
                    (Some(id),_)=>id,
                    (None,Some(current))=>current,
                    (None,None)=>return Err("Task is unassigned. Specify --agent".into()),
                };
                let agent=people.as_ref().unwrap().iter().find(|p|p.id==agent_id).ok_or_else(||format!("Participant not found: {agent_id}"))?;
                if agent.kind!="agent"{return Err(format!("Task is assigned to {agent_id}, who is not an agent. Only participants of type agent can claim tasks"));}
                let session=args.need("session")?; if session.chars().count()>120{return Err("Session name is too long".into());}
                let lease=agents::unique();token=Some(lease.clone());
                task["assigneeId"]=json!(agent.id);task["claim"]=json!({"assigneeId":agent.id,"sessionId":session,"token":lease,"id":agents::unique(),"startedAt":agents::now()});
                task["readyForReview"]=json!(false);task.as_object_mut().unwrap().remove("question");
                task["updatedAt"]=json!(agents::now()); move_task(v,col,index,"inProgress");
            },
            "report"=>{
                owner(task,&args)?;
                let entry=json!({"authorId":task["claim"]["assigneeId"],"sessionId":args.need("session")?,"claimId":task["claim"]["id"],"createdAt":agents::now(),"text":report.as_ref().unwrap()});
                if !task["reports"].is_array(){task["reports"]=json!([]);}
                task["reports"].as_array_mut().unwrap().push(entry);
                task["updatedAt"]=json!(agents::now());
            },
            "ask"=>{owner(task,&args)?;let message=args.need("message")?;if message.chars().count()>10_000{return Err("Question exceeds 10000 characters".into());}task["question"]=json!(message);task["readyForReview"]=json!(false);task["updatedAt"]=json!(agents::now());},
            "submit"=>{
                owner(task,&args)?;
                let session=args.need("session")?;
                if !task["reports"].as_array().is_some_and(|r|r.iter().any(|r|r["sessionId"]==session && r["claimId"]==task["claim"]["id"])){return Err("Add a report for the current claim using the report command first".into());}
                task["readyForReview"]=json!(true);task.as_object_mut().unwrap().remove("question");task["updatedAt"]=json!(agents::now());move_task(v,col,index,"inProgress");
            },
            "release"=>{
                if args.get("force").is_none(){owner(task,&args)?;}
                task.as_object_mut().unwrap().remove("claim");task["readyForReview"]=json!(false);task.as_object_mut().unwrap().remove("question");task["updatedAt"]=json!(agents::now());
                if col!="done"{move_task(v,col,index,"todo");}
            },
            _=>return Err(HELP.into())
        } Ok(())
    })?;
    let v=serde_json::to_value(result).map_err(|e|e.to_string())?;let (col,index)=locate(&v,number)?;
    let mut output=view(&dir,&v,col,&v[col][index])?;
    if let Some(token)=token{output["token"]=json!(token);}
    Ok(output)
}
pub fn run(){
    let args:Vec<String>=std::env::args().skip(1).collect();
    if args.is_empty() || args.iter().any(|a|a=="--help" || a=="-h"){println!("{HELP}");return;}
    match execute(args){Ok(v)=>println!("{}",serde_json::to_string_pretty(&v).unwrap()),Err(e)=>{eprintln!("{}",json!({"error":e}));std::process::exit(1);}}
}

#[cfg(test)] mod tests {
    use super::*;
    struct Fixture(PathBuf);
    impl Fixture {fn new()->Self{
        static NEXT:std::sync::atomic::AtomicUsize=std::sync::atomic::AtomicUsize::new(0);
        let n=NEXT.fetch_add(1,std::sync::atomic::Ordering::Relaxed);
        let root=std::env::temp_dir().join(format!("tasktrack-cli-test-{}-{n}",agents::unique()));
        let dir=root.join("projects/test");fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("project.json"),r#"{"name":"Task Track","createdAt":1}"#).unwrap();
        board::store(&dir,&board::new_board()).unwrap();Self(root)
    }
    fn run(&self,words:&[&str])->CmdResult<Value>{let mut args=vec!["--data-dir".into(),self.0.to_string_lossy().into_owned()];args.extend(words.iter().map(|s|s.to_string()));execute(args)}
    }
    impl Drop for Fixture{fn drop(&mut self){let _=fs::remove_dir_all(&self.0);}}
    #[test] fn workflow_claim_report_submit_release_and_permissions(){
        let f=Fixture::new();
        f.run(&["tasks","create","--project","test","--title","Implement search","--assignee","codex","--label","Feature"]).unwrap();
        assert!(f.run(&["tasks","claim","TT-1","--agent","claude","--session","c1"]).is_err());
        let lease=f.run(&["tasks","claim","TT-1","--agent","codex","--session","s1"]).unwrap();let token=lease["token"].as_str().unwrap();
        assert_eq!(lease["status"],"inProgress");
        assert!(f.run(&["tasks","claim","TT-1","--agent","codex","--session","s2"]).is_err());
        assert!(f.run(&["tasks","submit","TT-1","--session","s1","--token",token]).is_err());
        assert!(f.run(&["tasks","ask","TT-1","--session","wrong","--token",token,"--message","Hi"]).is_err());
        let report=f.0.join("report.md");fs::write(&report,"Implemented search. Checks passed.").unwrap();
        let path=report.to_str().unwrap();
        f.run(&["tasks","ask","TT-1","--session","s1","--token",token,"--message","Which fields?"]).unwrap();
        f.run(&["tasks","report","TT-1","--session","s1","--token",token,"--file",path]).unwrap();
        let submitted=f.run(&["tasks","submit","TT-1","--session","s1","--token",token]).unwrap();
        assert_eq!(submitted["status"],"inProgress");assert_eq!(submitted["task"]["readyForReview"],true);assert!(submitted["task"]["question"].is_null());
        assert!(submitted["task"]["claim"]["token"].is_null());
        let released=f.run(&["tasks","release","TT-1","--force"]).unwrap();assert_eq!(released["status"],"todo");assert_eq!(released["task"]["reports"].as_array().unwrap().len(),1);
        assert!(f.run(&["tasks","report","TT-1","--session","s1","--token",token,"--file",path]).is_err());
        let lease2=f.run(&["tasks","claim","TT-1","--agent","codex","--session","s1"]).unwrap();
        assert!(f.run(&["tasks","submit","TT-1","--session","s1","--token",lease2["token"].as_str().unwrap()]).is_err());
    }
    #[test] fn decode_text_handles_bom_and_rejects_non_utf8(){
        assert_eq!(decode_text("\u{FEFF}Отчёт".as_bytes().to_vec(),"file").unwrap(),"Отчёт");
        assert!(decode_text(vec![0xCE,0xF2,0xF7],"file").unwrap_err().contains("UTF-8"));
    }
    #[test] fn claim_defaults_to_assignee(){
        let f=Fixture::new();
        f.run(&["tasks","create","--project","test","--title","Assigned","--assignee","claude"]).unwrap();
        f.run(&["tasks","create","--project","test","--title","Unassigned"]).unwrap();
        f.run(&["tasks","create","--project","test","--title","Human","--assignee","you"]).unwrap();
        let err=f.run(&["tasks","claim","TT-1","--agent","codex","--session","s0"]).unwrap_err();
        assert!(err.contains("claude"),"{err}");
        let lease=f.run(&["tasks","claim","TT-1","--session","s1"]).unwrap();
        assert_eq!(lease["task"]["claim"]["assigneeId"],"claude");assert!(lease["token"].is_string());
        assert!(f.run(&["tasks","claim","TT-2","--session","s2"]).unwrap_err().contains("--agent"));
        assert_eq!(f.run(&["tasks","claim","TT-2","--session","s2","--agent","codex"]).unwrap()["task"]["assigneeId"],"codex");
        assert!(f.run(&["tasks","claim","TT-3","--session","s3"]).is_err());
        assert!(f.run(&["tasks","claim","TT-3","--session","s3","--agent","nobody"]).is_err());
    }
    #[test] fn two_concurrent_sessions_only_one_claims_task(){
        let f=Fixture::new();f.run(&["tasks","create","--project","test","--title","Shared"]).unwrap();
        let barrier=std::sync::Arc::new(std::sync::Barrier::new(2));let mut handles=vec![];
        for session in ["s1","s2"]{let root=f.0.clone();let b=barrier.clone();handles.push(std::thread::spawn(move||{b.wait();execute(vec!["--data-dir".into(),root.to_string_lossy().into_owned(),"tasks".into(),"claim".into(),"TT-1".into(),"--agent".into(),"codex".into(),"--session".into(),session.into()]).is_ok()}));}
        assert_eq!(handles.into_iter().map(|h|h.join().unwrap() as usize).sum::<usize>(),1);
    }
    #[test] fn concurrent_creations_and_global_participants(){
        let f=Fixture::new();let mut handles=vec![];
        for n in 0..4 {let root=f.0.clone();handles.push(std::thread::spawn(move||execute(vec!["--data-dir".into(),root.to_string_lossy().into_owned(),"tasks".into(),"create".into(),"--project".into(),"test".into(),"--title".into(),format!("Task {n}")]).unwrap()));}
        let values:Vec<_>=handles.into_iter().map(|h|h.join().unwrap()).collect();
        let numbers:std::collections::HashSet<_>=values.iter().map(|v|v["task"]["number"].as_u64().unwrap()).collect();assert_eq!(numbers.len(),4);
        f.run(&["participants","add","--name","Reviewer","--kind","human"]).unwrap();
        assert_eq!(f.run(&["participants","list"]).unwrap().as_array().unwrap().len(),4);
    }
}
