/** Shared Node, Worker and client contracts. Runtime validation lives in the
 * media-reference and catalog-selection modules; identities are minted by storage.
 *
 * @typedef {'yoru'|'ara-ara'} Destination
 * @typedef {'all'|'core'|'extensions'} IntegrationMode
 * @typedef {{id:string,kind:'anime'|'manga'|'extension-manga'}} MediaRef
 * @typedef {{id:string,kind:'mangadex'|'weebcentral'|'extension'}} EditionRef
 * @typedef {{overrides:Object<string,Partial<Record<Destination,boolean>>>,modes:Record<Destination,IntegrationMode>}} CatalogSelection
 * @typedef {{rating:'safe'|'adult'|'mixed'|'unknown',provenance:{sourceField:string|null,value:unknown,checkedAt:string}}} Classification
 * @typedef {'supported'|'unsupported'|'unverified'} Capability
 * @typedef {{popular:Capability,latest:Capability,search:Capability,details:Capability,chapters:Capability,pages:Capability,resolveLink:Capability}} Capabilities
 * @typedef {{id:string,integration:'core'|'suwayomi',upstreamSourceId:string|null,providerKey:string,language:string,classification:Classification,capabilities:Capabilities,bridgeInstance:string|null}} SourceRef
 * @typedef {{sourceId:string,upstreamKey:string,language:string}} UpstreamTitleRef
 * @typedef {{title:UpstreamTitleRef,upstreamKey:string}} UpstreamEditionRef
 * @typedef {{sourceRef:SourceRef,upstreamRef:UpstreamTitleRef,localMangaId:string|null,classification:Classification,metadata:Object<string,unknown>}} BridgeTitle
 * @typedef {{sourceRef:SourceRef,upstreamRef:UpstreamEditionRef,localMangaId:string|null,localChapterId:string|null,metadata:Object<string,unknown>}} BridgeEdition
 * @typedef {{sourceId:string,state:'ready'|'empty'|'unsupported'|'unverified'|'unavailable'|'stale',status:string|null,retryAt:string|null,operation:string,reason:'auth-required'|'access-challenge'|'rate-limited'|'offline'|'removed'|null}} SourceState
 * @typedef {{items:BridgeTitle[],nextPage:number|null,hasMore:boolean,sourceState:SourceState}} BridgeFeed
 * @typedef {{edition:BridgeEdition,pages:number[]}} BridgeManifest
 * @typedef {{body:Uint8Array,type:string,cached:boolean}} BinaryAsset
 * @typedef {{signal:AbortSignal,deadlineAt:number,priority:'interactive'|'discovery'}} OperationContext
 * @typedef {{destination:Destination,integrationMode:IntegrationMode,userId:string|null,sessionHash:string|null,guestId:string|null,overrides:CatalogSelection['overrides'],selectionFingerprint:string,language:string,signal:AbortSignal}} ReaderContext
 * @typedef {Object<string,unknown> & {id:string,sourceRef:SourceRef,upstreamRef:UpstreamTitleRef,classification:Classification,provenance:unknown,category:string,availableIntegrations:Array<'core'|'suwayomi'>}} ReadingMedia
 * @typedef {Object<string,unknown> & {id:string,mediaId:string,sourceRef:SourceRef,upstreamRef:UpstreamEditionRef,integration:'core'|'suwayomi',volume:number|string|null,number:number|null,language:string,order:number,pageCount:number|null,pages:number|null}} ReadingEdition
 * @typedef {{items:ReadingMedia[],nextCursor:string|null,hasMore:boolean,total:null,totalIsEstimate:true,sourceStates:SourceState[],selectionFingerprint:string,nextPage?:number|null}} FeedPage
 * @typedef {{sql:string,values:unknown[]}} DbStatement
 * @typedef {{userId:string,sessionHash:string}} DbGuard
 * @typedef {{get:(sql:string,...values:unknown[])=>Promise<any>,all:(sql:string,...values:unknown[])=>Promise<any[]>,run:(sql:string,...values:unknown[])=>Promise<any>,atomic:(statements:DbStatement[],guard?:DbGuard)=>Promise<any>}} ReaderDb
 *
 * Public opaque IDs must be resolved from storage before invoking this gateway.
 * Upstream source IDs and local Suwayomi IDs stay strings, without number coercion.
 * Core adapters retain their existing URLs and shapes; generic results below are
 * normalized/stored before public serialization. Reader manifests retain the
 * direct chapter DTO and same-origin {url} page objects at the public API boundary.
 *
 * @typedef {object} ExtensionGateway
 * @property {(input:object,context:OperationContext)=>Promise<{sources:SourceRef[],nextCursor:string|null}>} catalogs
 * @property {(input:object,context:OperationContext)=>Promise<BridgeFeed>} browse
 * @property {(ref:UpstreamTitleRef,context:OperationContext)=>Promise<BridgeTitle>} details
 * @property {(ref:UpstreamTitleRef,context:OperationContext)=>Promise<{items:BridgeEdition[],nextPage:number|null,hasMore:boolean,sourceState:SourceState}>} chapters
 * @property {(ref:UpstreamEditionRef,context:OperationContext)=>Promise<BridgeEdition>} chapter
 * @property {(ref:UpstreamEditionRef,context:OperationContext)=>Promise<BridgeManifest>} reader
 * @property {(ref:UpstreamTitleRef,context:OperationContext)=>Promise<BinaryAsset>} cover
 * @property {(ref:UpstreamEditionRef,page:number,context:OperationContext)=>Promise<BinaryAsset>} page
 * @property {(input:object,context:OperationContext)=>Promise<BridgeTitle>} resolveLink
 * @typedef {{db:ReaderDb,coreMedia:Function,bridge:ExtensionGateway,now:()=>number,uuid:()=>string}} ReaderDeps
 */

export {};
