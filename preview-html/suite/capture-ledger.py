from pathlib import Path
import sys,json,re,urllib.request,urllib.parse,hashlib,datetime
p=Path(__file__).parent/'capture-ledger.json';r=json.loads(p.read_text());action,key,response=sys.argv[1:4];data=json.loads(response);text='\n'.join(c.get('text','')for c in data.get('content',[])if c.get('type')=='text')
if action=='register':
 if key in r['captures']:raise SystemExit('Capture already registered; do not duplicate '+key)
 cid=re.search(r'Capture ID generated: `([^`]+)`',text).group(1)
 source=p.parent/(key+'.html');entry={'captureId':cid,'status':'issued','source':'suite/'+source.name,'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'issuedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'themes':['light','dark'],'devices':['desktop','mobile'],'initialResponse':data};r['captures'][key]=entry;p.write_text(json.dumps(r,ensure_ascii=False,indent=2))
 url='http://127.0.0.1:4173/suite/'+key+'.html#'+urllib.parse.urlencode({'figmacapture':cid,'figmaendpoint':'https://mcp.figma.com/mcp/capture/'+cid+'/submit?bindVariables=true','figmadelay':'1200','figmaselector':'#capture-root'})
 target=json.load(urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:9339/json/new?'+urllib.parse.quote(url,safe=''),method='PUT')))
 entry['browserTargetId']=target['id'];p.write_text(json.dumps(r,ensure_ascii=False,indent=2));print(json.dumps({'key':key,'captureId':cid,'targetId':target['id']}))
elif action=='complete':
 entry=r['captures'][key];entry['lastResponse']=data
 m=re.search(r'https://www.figma.com/design/[^\s]+\?node-id=(\d+)-(\d+)',text)
 if m:
  entry.update(status='added_unverified_native',nodeId=m[1]+':'+m[2],url=m[0],captureMethod='HTML script tag / Chromium CLI browser');p.write_text(json.dumps(r,ensure_ascii=False,indent=2));print(json.dumps({'key':key,'nodeId':entry['nodeId'],'url':entry['url']}))
  tid=entry.get('browserTargetId')
  if tid:urllib.request.urlopen('http://127.0.0.1:9339/json/close/'+tid).read()
 else:
  entry['status']='pending_or_error';p.write_text(json.dumps(r,ensure_ascii=False,indent=2));print(json.dumps({'key':key,'status':entry['status'],'message':text[:200]}))
