import json, os
P='/Users/liyuhang/Documents/git_projects/Toonflow-app-master/.easyvibe/map/parts'
def e(i,f,t,typ,label,strength,viol=False):
    d={"id":f"e{i}","from":f,"to":t,"type":typ,"label":label,"strength":strength}
    if viol: d["direction_violation"]=True
    return d
edges={
 'media-toolkit':[e(1,'media-toolkit','shared-foundation','import','file/i18n 基础调用','normal')],
 'ai-providers':[e(2,'ai-providers','media-toolkit','import','ffmpeg 类型与转码','normal')],
 'agent-tools':[e(3,'agent-tools','media-toolkit','import','ffmpeg/asr 运行时','strong'),
                e(4,'agent-tools','shared-foundation','import','file/i18n','strong')],
 'agent-runtime':[e(5,'agent-runtime','agent-tools','import','tool-canvas/asset-operator 运行时','strong'),
                  e(6,'agent-runtime','server-api','import','@/utils 与 @/lib 应用能力','strong',True),
                  e(7,'agent-runtime','shared-foundation','import','@toonflow/file 会话文件','weak')],
 'server-api':[e(8,'server-api','agent-runtime','import','agent.run / a2a / bridge','strong'),
               e(9,'server-api','agent-tools','import','MCP 与工具运行时','strong'),
               e(10,'server-api','ai-providers','import','供应商清单与模型目录','strong'),
               e(11,'server-api','media-toolkit','import','ffmpeg 执行','normal'),
               e(12,'server-api','shared-foundation','import','file/i18n','strong')],
 'canvas-extensions':[e(13,'canvas-extensions','shared-foundation','import','file/i18n','weak')],
 'workflow-nodes':[e(14,'workflow-nodes','agent-tools','import','tools-scaffold 运行时类型','weak'),
                   e(15,'workflow-nodes','media-toolkit','import','浏览器 ffmpeg/asr','strong'),
                   e(16,'workflow-nodes','shared-foundation','import','file','weak')],
 'web-console':[e(17,'web-console','agent-tools','import','工具面板与运行时','strong'),
                e(18,'web-console','ai-providers','import','供应商清单与模板','strong'),
                e(19,'web-console','canvas-extensions','import','ext-scaffold 运行时','normal'),
                e(20,'web-console','media-toolkit','import','@toonflow/asr','weak'),
                e(21,'web-console','server-api','api','REST /api 与共享类型','strong'),
                e(22,'web-console','shared-foundation','import','i18n/assets','strong'),
                e(23,'web-console','workflow-nodes','import','节点 UI 与运行时','strong')],
 'mobile-shell':[e(24,'mobile-shell','server-api','call','内嵌 createApp 与 remoteConnection','strong'),
                 e(25,'mobile-shell','shared-foundation','import','file','strong'),
                 e(26,'mobile-shell','web-console','import','browserCapabilities 探针','normal')],
 'desktop-shell':[e(27,'desktop-shell','server-api','call','sidecar 启动 @toonflow/server/app','strong'),
                  e(28,'desktop-shell','shared-foundation','import','file/i18n','normal')],
}
for mid,es in edges.items():
    json.dump({"module":mid,"edges":es},open(os.path.join(P,mid+'.edges.json'),'w'),ensure_ascii=False,indent=2)
print('edges',sum(len(v) for v in edges.values()))
