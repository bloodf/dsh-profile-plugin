/** Company profile and capability inheritance model. */
import { credentialRef } from '@deepseek-ai/dsh-credentials'
export type CapabilityKind = 'mcp' | 'skill' | 'plugin'
export type CapabilityState = 'enabled' | 'disabled'
export interface McpDefinition { transport: 'stdio' | 'streamable-http'; serverName: string; command?: string; args?: string[]; env?: Record<string,string>; envRefs?: Record<string,string>; cwd?: string; url?: string; headers?: Record<string,string>; headerRefs?: Record<string,string>; oauth?: boolean }
export interface CapabilityOverride { kind: CapabilityKind; key: string; state: CapabilityState; config?: unknown }
export interface EffectiveCapability extends CapabilityOverride { source: 'inherited' | 'local'; definitionProfileId: string; executionProfileId: string }
export interface ProfileFields { displayName?: string|null; legalName?: string|null; description?: string|null; website?: string|null; color?: string|null; avatarSeed?: string|null }
export interface CompanyProfile { id:string; parentId:string|null; archived:boolean; createdAt:string; updatedAt:string; fields:ProfileFields; capabilities:CapabilityOverride[] }
export interface ProfileDocument { schemaVersion:1; revision:number; defaultProfileId:string; order:string[]; profiles:CompanyProfile[] }
export interface ResolvedCompanyProfile extends Omit<CompanyProfile,'fields'|'capabilities'> { fields:Readonly<Required<ProfileFields>>; capabilities:Readonly<EffectiveCapability[]>; localOverrides:Readonly<CapabilityOverride[]> }
export const DEFAULT_PROFILE_ID='default'
export const DEFAULT_COLORS=Object.freeze(['#2563eb','#7c3aed','#db2777','#dc2626','#ea580c','#ca8a04','#16a34a','#0891b2'] as const)
const FIELD_KEYS=['displayName','legalName','description','website','color','avatarSeed'] as const
const DOCUMENT_KEYS=['schemaVersion','revision','defaultProfileId','order','profiles'] as const
const PROFILE_KEYS=['id','parentId','archived','createdAt','updatedAt','fields','capabilities'] as const
const CAPABILITY_KEYS=['kind','key','state','config'] as const
const STDIO_MCP_KEYS=['transport','serverName','command','args','env','envRefs','cwd'] as const
const HTTP_MCP_KEYS=['transport','serverName','url','headers','headerRefs','oauth'] as const
export function createDefaultDocument(now=new Date().toISOString()):ProfileDocument{return{schemaVersion:1,revision:0,defaultProfileId:DEFAULT_PROFILE_ID,order:[DEFAULT_PROFILE_ID],profiles:[{id:DEFAULT_PROFILE_ID,parentId:null,archived:false,createdAt:now,updatedAt:now,fields:{displayName:'Default profile'},capabilities:[]}]}}
export function stableHash(value:string):number{let hash=0x811c9dc5;for(const byte of new TextEncoder().encode(value)){hash^=byte;hash=Math.imul(hash,0x01000193)}return hash>>>0}
export function defaultAvatarSeed(id:string):string{return`company-${stableHash(id).toString(36)}`}
export function defaultColor(id:string):string{return DEFAULT_COLORS[stableHash(id)%DEFAULT_COLORS.length]!}
export function validateDocument(value:unknown):ProfileDocument{if(!record(value)||!hasOnlyKeys(value,DOCUMENT_KEYS)||value.schemaVersion!==1||!Number.isSafeInteger(value.revision)||Number(value.revision)<0||typeof value.defaultProfileId!=='string'||!Array.isArray(value.order)||!Array.isArray(value.profiles))throw new TypeError('invalid company profiles document');const profiles=value.profiles.map(validateProfile);const ids=new Set(profiles.map(p=>p.id));if(ids.size!==profiles.length||!ids.has(value.defaultProfileId))throw new TypeError('invalid profile identities');if(value.order.length!==profiles.length||new Set(value.order).size!==value.order.length||value.order.some(id=>typeof id!=='string'||!ids.has(id)))throw new TypeError('invalid profile order');const root=profiles.find(p=>p.id===value.defaultProfileId)!;if(root.parentId!==null||root.archived)throw new TypeError('default profile must be active root');for(const profile of profiles)if(profile.id!==root.id&&profile.parentId!==root.id)throw new TypeError('company profiles may inherit only from default profile');return structuredClone({...value,profiles}) as ProfileDocument}
export function resolveProfile(document:ProfileDocument,id:string):ResolvedCompanyProfile{const profile=document.profiles.find(p=>p.id===id);if(!profile)throw new RangeError(`unknown profile '${id}'`);const root=document.profiles.find(p=>p.id===document.defaultProfileId)!;const fields:Record<keyof ProfileFields,string|null>={displayName:null,legalName:null,description:null,website:null,color:null,avatarSeed:null};for(const current of profile.id===root.id?[root]:[root,profile])for(const key of FIELD_KEYS)if(Object.hasOwn(current.fields,key))fields[key]=current.fields[key]??null;fields.color??=defaultColor(profile.id);fields.avatarSeed??=defaultAvatarSeed(profile.id);const effective=new Map<string,EffectiveCapability>();for(const item of root.capabilities)if(item.state==='enabled')effective.set(capId(item),{...structuredClone(item),source:profile.id===root.id?'local':'inherited',definitionProfileId:root.id,executionProfileId:profile.id});if(profile.id!==root.id)for(const item of profile.capabilities){const key=capId(item);if(item.state==='disabled')effective.delete(key);else effective.set(key,{...structuredClone(item),source:'local',definitionProfileId:profile.id,executionProfileId:profile.id})}return{...structuredClone(profile),fields:Object.freeze(fields),capabilities:Object.freeze([...effective.values()]),localOverrides:Object.freeze(structuredClone(profile.capabilities))}}
function validateProfile(value:unknown):CompanyProfile{if(!record(value)||!hasOnlyKeys(value,PROFILE_KEYS)||typeof value.id!=='string'||!/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(value.id)||!(value.parentId===null||typeof value.parentId==='string')||typeof value.archived!=='boolean'||typeof value.createdAt!=='string'||typeof value.updatedAt!=='string'||!record(value.fields))throw new TypeError('invalid company profile');for(const[key,field]of Object.entries(value.fields))if(!(FIELD_KEYS as readonly string[]).includes(key)||!(field===null||typeof field==='string'))throw new TypeError(`invalid profile field '${key}'`);const capabilities=value.capabilities===undefined?[]:value.capabilities;if(!Array.isArray(capabilities))throw new TypeError('invalid capabilities');const checked=capabilities.map(validateCapability);if(new Set(checked.map(capId)).size!==checked.length)throw new TypeError('duplicate capability override');return structuredClone({...value,capabilities:checked}) as CompanyProfile}
function validateCapability(value:unknown):CapabilityOverride{if(!record(value)||!hasOnlyKeys(value,CAPABILITY_KEYS)||!['mcp','skill','plugin'].includes(String(value.kind))||typeof value.key!=='string'||!value.key||!['enabled','disabled'].includes(String(value.state)))throw new TypeError('invalid capability override');if(value.state==='disabled'&&Object.hasOwn(value,'config'))throw new TypeError('disabled capability cannot carry config');if(value.kind==='mcp'&&value.state==='enabled')validateMcpDefinition(value.config);return structuredClone(value) as unknown as CapabilityOverride}
function capId(value:Pick<CapabilityOverride,'kind'|'key'>):string{return`${value.kind}:${value.key}`}
function record(value:unknown):value is Record<string,unknown>{return typeof value==='object'&&value!==null&&!Array.isArray(value)}
function hasOnlyKeys(value:Record<string,unknown>,keys:readonly string[]):boolean{return Object.keys(value).every(key=>keys.includes(key))}
function isSecretLikeKey(key:string):boolean{return /_(TOKEN|SECRET|KEY|PASSWORD)$/i.test(key)}
function validateRefMap(value:unknown,label:string):void{
  if(value===undefined)return
  if(!record(value))throw new TypeError(`invalid MCP definition: ${label}`)
  for(const[k,v]of Object.entries(value)){
    if(typeof v!=='string')throw new TypeError(`invalid MCP definition: ${label} value`)
    try{credentialRef(v)}catch{throw new TypeError(`invalid MCP definition: ${label} '${k}' is not a valid credential reference`)}
  }
}
function validateMcpDefinition(value:unknown):McpDefinition{
  if(!record(value))throw new TypeError('invalid MCP definition')
  if(value.transport==='stdio'){
    if(!hasOnlyKeys(value,STDIO_MCP_KEYS))throw new TypeError('invalid MCP definition: unknown key for stdio transport')
    if(typeof value.serverName!=='string'||!value.serverName)throw new TypeError('invalid MCP definition: serverName')
    if(typeof value.command!=='string'||!value.command)throw new TypeError('invalid MCP definition: command required for stdio transport')
    if(value.args!==undefined&&(!Array.isArray(value.args)||value.args.some(a=>typeof a!=='string')))throw new TypeError('invalid MCP definition: args')
    if(value.env!==undefined){
      if(!record(value.env))throw new TypeError('invalid MCP definition: env')
      for(const[k,v]of Object.entries(value.env)){
        if(typeof v!=='string')throw new TypeError('invalid MCP definition: env value')
        if(isSecretLikeKey(k))throw new TypeError(`invalid MCP definition: env key '${k}' looks like an inline secret; use envRefs with a credential reference instead`)
      }
    }
    validateRefMap(value.envRefs,'envRefs')
    if(value.cwd!==undefined&&typeof value.cwd!=='string')throw new TypeError('invalid MCP definition: cwd')
  } else if(value.transport==='streamable-http'){
    if(!hasOnlyKeys(value,HTTP_MCP_KEYS))throw new TypeError('invalid MCP definition: unknown key for streamable-http transport')
    if(typeof value.serverName!=='string'||!value.serverName)throw new TypeError('invalid MCP definition: serverName')
    if(typeof value.url!=='string'||!value.url)throw new TypeError('invalid MCP definition: url required for streamable-http transport')
    let parsedUrl:URL
    try{parsedUrl=new URL(value.url)}catch{throw new TypeError('invalid MCP definition: url must be a valid URL')}
    if(!['http:','https:'].includes(parsedUrl.protocol))throw new TypeError('invalid MCP definition: url must be HTTP(S)')
    if(value.headers!==undefined){
      if(!record(value.headers))throw new TypeError('invalid MCP definition: headers')
      for(const[k,v]of Object.entries(value.headers)){
        if(typeof v!=='string')throw new TypeError('invalid MCP definition: header value')
        if(k.toLowerCase()==='authorization')throw new TypeError('invalid MCP definition: static Authorization header not allowed; use headerRefs or oauth')
      }
    }
    validateRefMap(value.headerRefs,'headerRefs')
    if(value.oauth!==undefined&&typeof value.oauth!=='boolean')throw new TypeError('invalid MCP definition: oauth')
  } else {
    throw new TypeError('invalid MCP definition: unsupported transport')
  }
  return structuredClone(value) as unknown as McpDefinition
}
