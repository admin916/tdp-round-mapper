// Account-specific release helper. Private material stays under ignored build/signing.
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createSign,randomBytes} from 'node:crypto';
import {homedir} from 'node:os';
import {resolve} from 'node:path';
const keyId=process.env.ASC_KEY_ID||'Q998X869M8',issuer=process.env.ASC_ISSUER_ID||'6b2f66f7-d1e7-4834-8578-0114b56a4457';
const keyPath=process.env.ASC_KEY_PATH||`${homedir()}/.appstoreconnect/private_keys/AuthKey_${keyId}.p8`;
export async function apple(path,method='GET',data) {
  const now=Math.floor(Date.now()/1000),b=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
  const input=b({alg:'ES256',kid:keyId,typ:'JWT'})+'.'+b({iss:issuer,iat:now,exp:now+600,aud:'appstoreconnect-v1'});
  const signature=createSign('SHA256').update(input).sign({key:readFileSync(keyPath),dsaEncoding:'ieee-p1363'}).toString('base64url');
  const r=await fetch('https://api.appstoreconnect.apple.com'+path,{method,headers:{authorization:`Bearer ${input}.${signature}`,'content-type':'application/json'},body:data?JSON.stringify(data):undefined,signal:AbortSignal.timeout(30000)});
  const result=await r.json();if(!r.ok)throw new Error(`Apple ${r.status}: ${result.errors?.map(e=>e.detail).join('; ')}`);return result;
}
const cmd=process.argv[2],appId='6790933467';
if(cmd==='inspect') {
  const builds=await apple(`/v1/builds?filter[app]=${appId}&sort=-uploadedDate&limit=5`);
  console.log(builds.data.map(b=>({id:b.id,version:b.attributes.version,status:b.attributes.processingState,uploaded:b.attributes.uploadedDate})));
  const groups=await apple(`/v1/apps/${appId}/betaGroups`);console.log('TestFlight groups:',groups.data.map(g=>({id:g.id,name:g.attributes.name,internal:g.attributes.isInternalGroup})));
} else if(cmd==='prepare-signing') {
  const dir=resolve('build/signing');mkdirSync(dir,{recursive:true,mode:0o700});
  let certificate;
  if(existsSync(dir+'/certificate-id'))certificate=readFileSync(dir+'/certificate-id','utf8').trim();
  else {
    execFileSync('openssl',['req','-new','-newkey','rsa:2048','-nodes','-keyout',dir+'/distribution.key','-out',dir+'/distribution.csr','-subj','/CN=V3tr4 Limited/O=V3tr4 Limited/C=GB'],{stdio:'ignore'});
    const r=await apple('/v1/certificates','POST',{data:{type:'certificates',attributes:{certificateType:'DISTRIBUTION',csrContent:readFileSync(dir+'/distribution.csr','utf8')}}});
    certificate=r.data.id;writeFileSync(dir+'/distribution.cer',Buffer.from(r.data.attributes.certificateContent,'base64'));writeFileSync(dir+'/certificate-id',certificate);
  }
  execFileSync('openssl',['x509','-inform','DER','-in',dir+'/distribution.cer','-out',dir+'/distribution.pem']);
  const password=randomBytes(24).toString('hex');
  execFileSync('openssl',['pkcs12','-export','-keypbe','PBE-SHA1-3DES','-certpbe','PBE-SHA1-3DES','-macalg','sha1','-inkey',dir+'/distribution.key','-in',dir+'/distribution.pem','-out',dir+'/distribution.p12','-passout','env:TDP_P12_PASS'],{env:{...process.env,TDP_P12_PASS:password},stdio:'ignore'});
  try {execFileSync('security',['import',dir+'/distribution.p12','-k',`${homedir()}/Library/Keychains/login.keychain-db`,'-P',password,'-T','/usr/bin/codesign','-T','/usr/bin/security'],{stdio:['ignore','pipe','pipe']});} catch {throw new Error('Distribution identity import failed; check the login keychain.');}
  const bundles=await apple('/v1/bundleIds?filter[identifier]=com.v3tr4.tdp');
  const profile=await apple('/v1/profiles','POST',{data:{type:'profiles',attributes:{name:'TDP Course Finder Release '+new Date().toISOString().slice(0,10),profileType:'IOS_APP_STORE'},relationships:{bundleId:{data:{type:'bundleIds',id:bundles.data[0].id}},certificates:{data:[{type:'certificates',id:certificate}]}}}});
  const a=profile.data.attributes,content=Buffer.from(a.profileContent,'base64');
  const profileDir=`${homedir()}/Library/Developer/Xcode/UserData/Provisioning Profiles`;mkdirSync(profileDir,{recursive:true});writeFileSync(`${profileDir}/${a.uuid}.mobileprovision`,content);
  writeFileSync(dir+'/profile.json',JSON.stringify({id:profile.data.id,uuid:a.uuid,name:a.name}));
  console.log('Distribution identity and provisioning profile ready:',a.name);
} else if(cmd==='build-status') {
  const r=await apple(`/v1/builds?filter[app]=${appId}&sort=-uploadedDate&limit=3`);console.log(r.data.map(b=>({id:b.id,build:b.attributes.version,state:b.attributes.processingState})));
}
