/* Shared workspace API backed by Node's built-in SQLite database. */
const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const dataDir = path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(path.join(dataDir, 'sprintboard.sqlite'));
db.exec(`PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,salt TEXT NOT NULL,password_hash TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS workspaces(id TEXT PRIMARY KEY,name TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS memberships(workspace_id TEXT NOT NULL,user_id TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'member',PRIMARY KEY(workspace_id,user_id));
CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,name TEXT NOT NULL,state TEXT NOT NULL DEFAULT '{}',version INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS invitations(token TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,email TEXT,expires_at TEXT NOT NULL,created_by TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS comments(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,story_id INTEGER NOT NULL,user_id TEXT NOT NULL,body TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS mentions(id TEXT PRIMARY KEY,comment_id TEXT NOT NULL,user_id TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(comment_id,user_id));
CREATE TABLE IF NOT EXISTS activity(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,user_id TEXT NOT NULL,kind TEXT NOT NULL,story_id INTEGER,detail TEXT NOT NULL,created_at TEXT NOT NULL);`);
const sessions = new Map();
const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();
const emailOK = s => typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
function send(res, status, value, headers = {}) { res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers }); res.end(JSON.stringify(value)); }
function body(req) { return new Promise((resolve,reject)=>{let raw='';req.on('data',c=>{raw+=c;if(raw.length>1000000){reject(new Error('Request is too large'));req.destroy();}});req.on('end',()=>{try{resolve(JSON.parse(raw||'{}'));}catch{reject(new Error('Invalid JSON'));}});req.on('error',reject);}); }
function cookie(req) { return (req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('sb_session='))?.slice(11); }
function userFor(req) { const uid=sessions.get(cookie(req)); return uid ? db.prepare('SELECT id,email,name FROM users WHERE id=?').get(uid) : null; }
function projectFor(user, projectId) { return db.prepare('SELECT p.* FROM projects p JOIN memberships m ON m.workspace_id=p.workspace_id WHERE p.id=? AND m.user_id=?').get(projectId,user.id); }
function members(workspaceId) { return db.prepare('SELECT u.id,u.email,u.name,m.role FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=? ORDER BY u.name').all(workspaceId); }
function changedStories(before,after,userId,projectId) {
 const old=new Map((before.stories||[]).map(s=>[String(s.id),s]));
 for(const s of after.stories||[]){const prev=old.get(String(s.id));let detail='';let kind='story_updated';
  if(!prev){kind='story_created';detail=`created “${s.title||'Untitled story'}”`;}
  else if(prev.status!==s.status){kind='story_moved';detail=`moved “${s.title||'Untitled story'}” to ${s.status}`;}
  else if(prev.assignee!==s.assignee){kind='story_assigned';detail=`assigned “${s.title||'Untitled story'}” to ${s.assignee||'nobody'}`;}
  else if(prev.title!==s.title){detail=`renamed a story to “${s.title||'Untitled story'}”`;}
  if(detail)db.prepare('INSERT INTO activity(id,project_id,user_id,kind,story_id,detail,created_at) VALUES(?,?,?,?,?,?,?)').run(id(),projectId,userId,kind,Number(s.id)||null,detail,now());
 }
 const next=new Set((after.stories||[]).map(s=>String(s.id)));
 for(const s of before.stories||[])if(!next.has(String(s.id)))db.prepare('INSERT INTO activity(id,project_id,user_id,kind,story_id,detail,created_at) VALUES(?,?,?,?,?,?,?)').run(id(),projectId,userId,'story_deleted',Number(s.id)||null,`deleted “${String(s.title||'Untitled story').slice(0,80)}”`,now());
}
async function handle(req,res,url) {
 const route=url.pathname;
 if(!route.startsWith('/api/team/'))return false;
 try {
  if(req.method==='POST'&&route==='/api/team/register'){
   const b=await body(req),email=String(b.email||'').trim().toLowerCase(),name=String(b.name||'').trim(),password=String(b.password||'');
   if(!emailOK(email)||!name||name.length>80||password.length<8)throw Object.assign(new Error('Enter your name, a valid email, and a password with at least 8 characters.'),{status:400});
   const salt=crypto.randomBytes(16).toString('hex'),hash=crypto.scryptSync(password,salt,64).toString('hex'),uid=id(),wid=id(),pid=id();
   try{db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run(uid,email,name,salt,hash,now());}catch(e){if(String(e.message).includes('UNIQUE'))throw Object.assign(new Error('An account already exists for that email. Sign in instead.'),{status:409});throw e;}db.prepare('INSERT INTO workspaces VALUES(?,?,?)').run(wid,`${name}'s workspace`,now());db.prepare('INSERT INTO memberships VALUES(?,?,?)').run(wid,uid,'owner');db.prepare('INSERT INTO projects VALUES(?,?,?,?,?,?)').run(pid,wid,'My project','{}',0,now());
   const token=crypto.randomBytes(32).toString('hex');sessions.set(token,uid);return send(res,201,{user:{id:uid,email,name},projects:[{id:pid,name:'My project',workspaceId:wid,workspaceName:`${name}'s workspace`}]},{'Set-Cookie':`sb_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`});
  }
  if(req.method==='POST'&&route==='/api/team/login'){
   const b=await body(req),email=String(b.email||'').trim().toLowerCase(),u=db.prepare('SELECT * FROM users WHERE email=?').get(email);if(!u||!crypto.timingSafeEqual(crypto.scryptSync(String(b.password||''),u.salt,64),Buffer.from(u.password_hash,'hex')))throw Object.assign(new Error('Email or password is incorrect.'),{status:401});
   const token=crypto.randomBytes(32).toString('hex');sessions.set(token,u.id);const projects=db.prepare('SELECT p.id,p.name,w.id workspaceId,w.name workspaceName FROM projects p JOIN workspaces w ON w.id=p.workspace_id JOIN memberships m ON m.workspace_id=w.id WHERE m.user_id=? ORDER BY p.name').all(u.id);return send(res,200,{user:{id:u.id,email:u.email,name:u.name},projects},{'Set-Cookie':`sb_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`});
  }
  if(req.method==='POST'&&route==='/api/team/logout'){sessions.delete(cookie(req));return send(res,200,{ok:true},{'Set-Cookie':'sb_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'});}
  if(req.method==='GET'&&route==='/api/team/me'){const user=userFor(req);if(!user)return send(res,200,{user:null});const projects=db.prepare('SELECT p.id,p.name,w.id workspaceId,w.name workspaceName FROM projects p JOIN workspaces w ON w.id=p.workspace_id JOIN memberships m ON m.workspace_id=w.id WHERE m.user_id=? ORDER BY w.name,p.name').all(user.id);return send(res,200,{user,projects});}
  const user=userFor(req);if(!user)throw Object.assign(new Error('Sign in to use team workspaces.'),{status:401});
  if(req.method==='POST'&&route==='/api/team/projects'){
   const b=await body(req),name=String(b.name||'').trim().slice(0,80);if(!name)throw new Error('Project name is required.');const wid=String(b.workspaceId||''),membership=wid&&db.prepare('SELECT role FROM memberships WHERE workspace_id=? AND user_id=?').get(wid,user.id);let workspaceId=wid;
   if(!membership){workspaceId=id();db.prepare('INSERT INTO workspaces VALUES(?,?,?)').run(workspaceId,`${user.name}'s workspace`,now());db.prepare('INSERT INTO memberships VALUES(?,?,?)').run(workspaceId,user.id,'owner');}
   const pid=id();db.prepare('INSERT INTO projects VALUES(?,?,?,?,?,?)').run(pid,workspaceId,name,'{}',0,now());return send(res,201,{project:{id:pid,name,workspaceId}});
  }
  if(req.method==='POST'&&route==='/api/team/invites'){
   const b=await body(req),wid=String(b.workspaceId||''),membership=db.prepare('SELECT role FROM memberships WHERE workspace_id=? AND user_id=?').get(wid,user.id);if(!membership||membership.role==='member')throw Object.assign(new Error('Only workspace owners can invite teammates.'),{status:403});const token=crypto.randomBytes(24).toString('hex'),email=String(b.email||'').trim().toLowerCase();db.prepare('INSERT INTO invitations VALUES(?,?,?,?,?)').run(token,wid,email||null,new Date(Date.now()+7*86400000).toISOString(),user.id);return send(res,201,{token,link:`${url.origin}/?invite=${token}`,expiresInDays:7});
  }
  if(req.method==='POST'&&route==='/api/team/join'){
   const b=await body(req),inv=db.prepare('SELECT * FROM invitations WHERE token=? AND expires_at>?').get(String(b.token||''),now());if(!inv)throw new Error('This invite is invalid or has expired.');if(inv.email&&inv.email!==user.email)throw Object.assign(new Error(`This invitation is for ${inv.email}.`),{status:403});db.prepare('INSERT OR IGNORE INTO memberships VALUES(?,?,?)').run(inv.workspace_id,user.id,'member');const projects=db.prepare('SELECT id,name FROM projects WHERE workspace_id=?').all(inv.workspace_id);return send(res,200,{projects});
  }
  const projectMatch=route.match(/^\/api\/team\/projects\/([^/]+)(?:\/(members|comments|activity))?$/);if(projectMatch){const pid=decodeURIComponent(projectMatch[1]),p=projectFor(user,pid);if(!p)throw Object.assign(new Error('Project not found or access denied.'),{status:404});const sub=projectMatch[2];
   if(!sub&&req.method==='GET')return send(res,200,{state:JSON.parse(p.state),version:p.version});
   if(!sub&&req.method==='PUT'){const b=await body(req);if(!b.state||!Array.isArray(b.state.stories))throw new Error('Invalid board state.');if(Number(b.version)!==p.version)return send(res,409,{error:'This project changed in another session.',version:p.version,state:JSON.parse(p.state)});const state=JSON.stringify(b.state);if(state.length>900000)throw new Error('Board data is too large.');const before=JSON.parse(p.state);changedStories(before,b.state,user.id,pid);const version=p.version+1;db.prepare('UPDATE projects SET state=?,version=?,updated_at=? WHERE id=?').run(state,version,now(),pid);return send(res,200,{version});}
   if(sub==='members'&&req.method==='GET')return send(res,200,{members:members(p.workspace_id)});
   if(sub==='comments'&&req.method==='GET'){const story=Number(url.searchParams.get('storyId'));return send(res,200,{comments:db.prepare('SELECT c.id,c.story_id storyId,c.body,c.created_at createdAt,u.id userId,u.name,u.email FROM comments c JOIN users u ON u.id=c.user_id WHERE c.project_id=? AND c.story_id=? ORDER BY c.created_at').all(pid,story)});}
   if(sub==='comments'&&req.method==='POST'){const b=await body(req),text=String(b.body||'').trim();if(!text||text.length>4000)throw new Error('Write a comment of 1 to 4000 characters.');const cid=id(),ts=now(),sid=Number(b.storyId);db.prepare('INSERT INTO comments VALUES(?,?,?,?,?,?)').run(cid,pid,sid,user.id,text,ts);db.prepare('INSERT INTO activity VALUES(?,?,?,?,?,?,?)').run(id(),pid,user.id,'comment',sid,`commented on “${String(b.storyTitle||'a story').slice(0,80)}”`,ts);const targets=[...text.matchAll(/@([\w.+-]+@[\w.-]+\.[A-Za-z]{2,})/g)].map(m=>m[1].toLowerCase());for(const email of new Set(targets)){const mentioned=db.prepare('SELECT u.id FROM users u JOIN memberships m ON m.user_id=u.id WHERE lower(u.email)=? AND m.workspace_id=?').get(email,p.workspace_id);if(mentioned){db.prepare('INSERT OR IGNORE INTO mentions VALUES(?,?,?,?)').run(id(),cid,mentioned.id,ts);db.prepare('INSERT INTO activity VALUES(?,?,?,?,?,?,?)').run(id(),pid,user.id,'mention',sid,`mentioned ${email} on “${String(b.storyTitle||'a story').slice(0,80)}”`,ts);}}return send(res,201,{comment:{id:cid,storyId:sid,body:text,createdAt:ts,userId:user.id,name:user.name,email:user.email}});}
   if(sub==='activity'&&req.method==='GET')return send(res,200,{activity:db.prepare('SELECT a.id,a.kind,a.story_id storyId,a.detail,a.created_at createdAt,u.name FROM activity a JOIN users u ON u.id=a.user_id WHERE a.project_id=? ORDER BY a.created_at DESC LIMIT 100').all(pid)});
  }
  return send(res,404,{error:'Team API route not found.'});
 }catch(e){return send(res,e.status||400,{error:e.message||'Team API request failed.'});}
}
module.exports={handle};
