/** Minimal browser UI components; host RPC/slot wiring waits for stable profile seams. */
import type { Context } from '@deepseek-ai/cordis'
import React from 'react'
export interface ProfileUiRow { id:string; name:string; color:string; avatarSeed:string; attention:number }
export function avatarData(seed:string,color:string){return{background:color,text:seed.slice(-2).toUpperCase()}}
export function ProfileSwitcher(props:{profiles:ProfileUiRow[];selected:string;onSelect:(id:string)=>void}){
 const options=props.profiles.map(profile=>React.createElement('option',{key:profile.id,value:profile.id},`${profile.name}${profile.attention ? ` (${profile.attention})` : ''}`))
 return React.createElement('label',null,'Profile',React.createElement('select',{value:props.selected,'aria-label':'Active profile',onChange:(event:React.ChangeEvent<HTMLSelectElement>)=>props.onSelect(event.target.value)},options))
}
export function ProfilesSettings(props:{profiles:ProfileUiRow[]}){
 const rows=props.profiles.map(profile=>React.createElement('li',{key:profile.id,style:{borderInlineStart:`4px solid ${profile.color}`,paddingInlineStart:8}},`${profile.name} — ${profile.attention} need attention`))
 return React.createElement('section',{'aria-label':'Profiles'},React.createElement('h2',null,'Profiles'),React.createElement('ul',null,rows))
}
export function apply(_ctx:Context):void{}
