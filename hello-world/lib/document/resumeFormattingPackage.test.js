// @vitest-environment node
// Independent contract fixtures. No network, Supabase, browser DOM or product mocks.
import { describe, it, expect, vi } from 'vitest';
const inflation = vi.hoisted(() => ({ bytes:0, maxChunk:0 }));
vi.mock('node:zlib', async importOriginal => { const actual=await importOriginal(); return {...actual,createInflateRaw(...args){ const stream=actual.createInflateRaw(...args);stream.prependListener('data',chunk=>{inflation.bytes+=chunk.length;inflation.maxChunk=Math.max(inflation.maxChunk,chunk.length);});return stream;}}; });
import JSZip from 'jszip';
import { createHash } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { validateFormattingPackage } from './resumeFormattingPackage';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const sha = value => createHash('sha256').update(value).digest('hex');
const text = 'Alex\u00a0Cedar\nI supported the migration lead.\n東京 — 17%';
const escape = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const body = text.split('\n').map(line => `<w:p><w:r><w:t xml:space="preserve">${escape(line)}</w:t></w:r></w:p>`).join('');
const documentXml = inner => `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${W}"><w:body>${inner}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:bottom="720" w:left="720" w:right="720"/></w:sectPr></w:body></w:document>`;
const contentTypes = '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="json" ContentType="application/json"/><Default Extension="txt" ContentType="text/plain"/><Default Extension="bin" ContentType="application/octet-stream"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>';
const rootRels = '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';
const ids = {accountId:'11111111-1111-4111-8111-111111111111',applicationId:'22222222-2222-4222-8222-222222222222',pairId:'33333333-3333-4333-8333-333333333333',operationId:'44444444-4444-4444-8444-444444444444',versionId:'55555555-5555-4555-8555-555555555555',baseVersionId:'66666666-6666-4666-8666-666666666666'};
const expectedBase = { ...ids, parentVersionId:ids.baseVersionId, captureId:sha('capture'),textHash:sha(text),htmlHash:sha('<p>capture</p>'),semanticText:text };
async function fixture({xml=documentXml(body), extras={}, marker=null, compression='STORE'}={}) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', contentTypes); zip.file('_rels/.rels',rootRels); zip.file('word/document.xml',xml);
  for (const [name,value] of Object.entries(extras)) zip.file(name,value);
  if(marker) zip.file('resume-tailor/formatting-v1.json',JSON.stringify(marker));
  return Buffer.from(await zip.generateAsync({type:'uint8array',compression,streamFiles:false}));
}
const markerFor = (xml,role='cleanup') => ({...ids,role,schemaVersion:1,kind:'resume-formatting',textHash:sha(text),htmlHash:expectedBase.htmlHash,parentVersionId:ids.baseVersionId,captureId:expectedBase.captureId,mainPartHash:sha(xml),serializerVersion:1,appliedChanges:[]});
async function validate(bytes, role='original', expected={}) {
 return validateFormattingPackage({bytes,role,expected:{...expectedBase,byteHash:sha(bytes),...expected}});
}
async function rejected(bytes, role='original', expected={}) {
 const result = await validate(bytes,role,expected);
 expect(result.ok).toBe(false); expect(result.package).toBeNull(); expect(result.code).toEqual(expect.any(String)); expect(result.code.length).toBeGreaterThan(0);
 return result;
}
function centralOffsets(bytes) {
 const out=[];
 for(let i=0;i<bytes.length-46;i++) if(bytes.readUInt32LE(i)===0x02014b50) out.push(i);
 return out;
}
function firstLocal(bytes) { return bytes.indexOf(Buffer.from([0x50,0x4b,0x03,0x04])); }
// A self-contained real ZIP builder permits hostile metadata that JSZip would normalize.
function crc32(bytes) { let crc=0xffffffff; for(const b of bytes){crc^=b;for(let k=0;k<8;k++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);} return (crc^0xffffffff)>>>0; }
function rawZip(entries) {
 const locals=[], centrals=[]; let offset=0;
 for(const item of entries){const name=Buffer.from(item.name),data=Buffer.from(item.data), compressed=Buffer.concat([item.deflate?deflateRawSync(data):data,item.tail||Buffer.alloc(0)]), size=item.declaredSize??data.length;
 const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(0x800,6);local.writeUInt16LE(item.deflate?8:0,8);local.writeUInt32LE(crc32(data),14);local.writeUInt32LE(compressed.length,18);local.writeUInt32LE(size,22);local.writeUInt16LE(name.length,26);
 const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(0x800,8);central.writeUInt16LE(item.deflate?8:0,10);central.writeUInt32LE(crc32(data),16);central.writeUInt32LE(compressed.length,20);central.writeUInt32LE(size,24);central.writeUInt16LE(name.length,28);central.writeUInt32LE(offset,42);
 locals.push(local,name,compressed);centrals.push(central,name);offset+=local.length+name.length+compressed.length;
 }
 const cd=Buffer.concat(centrals),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(cd.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...locals,cd,end]);
}
const baseEntries=()=>[{name:'[Content_Types].xml',data:contentTypes},{name:'_rels/.rels',data:rootRels},{name:'word/document.xml',data:documentXml(body)}];

describe('supported real Node package controls',()=>{
 it('validates actual ordinary ZIP without a browser DOMParser and preserves exact Unicode text',async()=>{
  expect(globalThis.DOMParser).toBeUndefined(); const bytes=await fixture(); const result=await validate(bytes);
  expect(result.ok).toBe(true);expect(result.package).not.toBeNull();expect(result.package.semanticText).toBe(text);expect(result.package.textHash).toBe(sha(text));expect(result.package.byteHash).toBe(sha(bytes));
 });
 it('validates actual DEFLATE package rather than refusing all compressed files',async()=>{expect((await validate(await fixture({compression:'DEFLATE'}))).ok).toBe(true);});
 it('validates a bound formatting package and requires its marker for before and cleanup',async()=>{
  const beforeBytes=await fixture({marker:markerFor(documentXml(body),'before')});const cleanupBytes=await fixture({marker:markerFor(documentXml(body),'cleanup')});expect((await validate(beforeBytes,'before')).ok).toBe(true);expect((await validate(cleanupBytes,'cleanup')).ok).toBe(true);
  await rejected(await fixture(),'before');await rejected(await fixture(),'cleanup');
 });
 it('refuses forged content hashes and lexical mutation despite a plausible marker',async()=>{
  const xml=documentXml(body.replace('supported','led'));
  await rejected(await fixture({xml,marker:markerFor(xml)}),'cleanup');
  const bytes=await fixture({marker:{...markerFor(documentXml(body)),textHash:sha('invented')}});await rejected(bytes,'cleanup');
 });
 it('does not normalize NBSP or discard non-Latin lexical evidence',async()=>{const bytes=await fixture();await rejected(bytes,'original',{semanticText:text.replace('\u00a0',' '),textHash:sha(text.replace('\u00a0',' '))});});
 it('rejects capture and parent marker substitution even when byte and text hashes are correct',async()=>{
  for(const field of ['captureId','parentVersionId']){const marker={...markerFor(documentXml(body)),[field]:field==='captureId'?sha('other-capture'):'77777777-7777-4777-8777-777777777777'};await rejected(await fixture({marker}),'cleanup');}
 });
 it('checks the exact external byte hash independently from the marker',async()=>{await rejected(await fixture(),'original',{byteHash:'0'.repeat(64)});});
 it('supports escaped XML built-ins and literal numeric references',async()=>{
  const xml=documentXml('<w:p><w:r><w:t>A &amp; B &lt; C &#x6771;</w:t></w:r></w:p>');const expectedText='A & B < C 東';const bytes=await fixture({xml});expect((await validate(bytes,'original',{semanticText:expectedText,textHash:sha(expectedText)})).ok).toBe(true);
 });
});

describe('actual ZIP structure boundaries',()=>{
 it.each(['../outside.xml','/absolute.xml','C:/drive.xml','word\\escape.xml'])('rejects unsafe entry path %s',async name=>{await rejected(rawZip([...baseEntries(),{name,data:'x'}]));});
 it('rejects duplicate and case-colliding entry names before JSZip can overwrite them',async()=>{for(const name of ['word/document.xml','WORD/DOCUMENT.XML'])await rejected(rawZip([...baseEntries(),{name,data:documentXml(body)}]));});
 it('rejects local versus central size disagreement and invalid CRC',async()=>{
  const bytes=await fixture();const c=centralOffsets(bytes)[0];const mismatch=Buffer.from(bytes);mismatch.writeUInt32LE(mismatch.readUInt32LE(c+24)+1,c+24);await rejected(mismatch);
  const bad=Buffer.from(bytes);bad.writeUInt32LE(0,firstLocal(bad)+14);bad.writeUInt32LE(0,centralOffsets(bad)[0]+16);const outcome=await rejected(bad);expect(outcome.code).toBe('invalid-zip');expect(outcome.error).toMatch(/CRC/i);
 });
 it('rejects encrypted and unsupported compression methods',async()=>{for(const mode of ['encrypted','method']){const bytes=await fixture();for(const c of centralOffsets(bytes)){if(mode==='encrypted')bytes.writeUInt16LE(bytes.readUInt16LE(c+8)|1,c+8);else bytes.writeUInt16LE(99,c+10);}const l=firstLocal(bytes);if(mode==='encrypted')bytes.writeUInt16LE(bytes.readUInt16LE(l+6)|1,l+6);else bytes.writeUInt16LE(99,l+8);await rejected(bytes);}});
 it('rejects ZIP64 or out-of-bounds central offsets',async()=>{const bytes=await fixture();const e=bytes.length-22;bytes.writeUInt32LE(0xffffffff,e+16);await rejected(bytes);});
 it('rejects overlap pointing two entries at one local record',async()=>{const bytes=await fixture();const cs=centralOffsets(bytes);bytes.writeUInt32LE(bytes.readUInt32LE(cs[0]+42),cs[1]+42);await rejected(bytes);});
 it('rejects more than128 entries with a known-valid small control',async()=>{const extras={};for(let i=0;i<130;i++)extras[`safe/${i}.txt`]='x';await rejected(await fixture({extras}));expect((await validate(await fixture({extras:{'safe/a.txt':'unchanged'}}))).ok).toBe(true);});
 it('stops actual inflation at its cap before length mismatch or XML parsing can mask it',async()=>{const entries=baseEntries();entries.push({name:'safe/payload.xml',data:'<a>'+ 'A'.repeat(2*1024*1024+1)+'</a>',deflate:true,declaredSize:4096});inflation.bytes=0;inflation.maxChunk=0;const outcome=await rejected(rawZip(entries));expect(outcome.code).toBe('package-limit');expect(outcome.error).toMatch(/inflation|bounds/i);expect(inflation.bytes).toBeGreaterThan(4096);expect(inflation.bytes).toBeLessThanOrEqual(4096+Math.max(inflation.maxChunk,65536));});
 it('rejects unconsumed compressed-stream tail with correct lengths CRC and directory offsets',async()=>{const entries=baseEntries().map(entry=>({...entry,deflate:true}));expect((await validate(rawZip(entries))).ok).toBe(true);entries[2].tail=Buffer.from([0x41,0x42,0x43,0x44]);const result=await rejected(rawZip(entries));expect(result.code).toBe('invalid-zip');});
 it('rejects input above4MiB before unbounded package parsing',async()=>{await rejected(Buffer.alloc(4*1024*1024+1));});
});

describe('strict XML and unsupported active content',()=>{
 it.each([
  '<!DOCTYPE w:document [<!ENTITY secret SYSTEM "file:///etc/passwd">]>',
  '<!DOCTYPE w:document [<!ENTITY secret "expansion">]>',
  '<?unsafe instruction?>',
 ])('rejects DTD entity or processing instruction %s',async prefix=>{await rejected(await fixture({xml:prefix+documentXml(body)}));});
 it('rejects malformed XML instead of accepting parser recovery',async()=>{await rejected(await fixture({xml:documentXml(body).replace('</w:r>','</w:wrong>')}));});
 it('rejects invalid UTF8 and alternate XML encodings',async()=>{await rejected(await fixture({extras:{'safe/bad.xml':Buffer.from([0x3c,0x61,0x3e,0xc3,0x28])}}));await rejected(await fixture({xml:documentXml(body).replace('UTF-8','UTF-16')}));});
 it('rejects external relationships even with an otherwise valid resume',async()=>{await rejected(await fixture({extras:{'word/_rels/document.xml.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" TargetMode="External" Target="https://example.org"/></Relationships>'}}));});
 it('rejects missing internal targets',async()=>{await rejected(await fixture({extras:{'word/_rels/document.xml.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="missing.xml"/></Relationships>'}}));});
 it.each(['<w:tbl/>','<w:fldSimple w:instr="DATE"/>','<w:ins/>','<w:drawing/>','<w:altChunk/>'])('refuses unsupported main-body feature %s without deleting it',async feature=>{await rejected(await fixture({xml:documentXml(body+feature)}));});
 it('rejects unknown meaningful run properties instead of silently flattening them',async()=>{await rejected(await fixture({xml:documentXml(body.replace('<w:r>','<w:r><w:rPr><w:vanish/></w:rPr>'))}));});
 it('rejects excessive XML depth and attribute count',async()=>{await rejected(await fixture({extras:{'safe/deep.xml':'<a>'.repeat(66)+'x'+'</a>'.repeat(66)}}));const attrs=Array.from({length:65},(_,i)=>`a${i}="v"`).join(' ');await rejected(await fixture({extras:{'safe/attrs.xml':`<a ${attrs}/>`}}));});
 it('rejects XML parts beyond1MiB without requiring a browser parser',async()=>{await rejected(await fixture({extras:{'safe/large.xml':'<a>'+ 'x'.repeat(1024*1024)+'</a>'}}));});
});




describe('closed supported OOXML properties and OPC',()=>{
 it('accepts real supported typography paragraph list and section properties',async()=>{
  const xml=documentXml('<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="120" w:after="80" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="24"/><w:b/><w:color w:val="123456"/></w:rPr><w:t>Heading</w:t></w:r></w:p><w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="3"/></w:numPr><w:ind w:left="720" w:hanging="360"/></w:pPr><w:r><w:t>Item</w:t></w:r></w:p>');
  const numbering='<w:numbering xmlns:w="'+W+'"><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="3"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="3"><w:abstractNumId w:val="1"/></w:num></w:numbering>';
  const rel='<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rNum" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>';
  const types=contentTypes.replace('</Types>','<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>');
  const expectedText='Heading\nItem';const bytes=await fixture({xml,extras:{'[Content_Types].xml':types,'word/numbering.xml':numbering,'word/_rels/document.xml.rels':rel}});const result=await validate(bytes,'original',{semanticText:expectedText,textHash:sha(expectedText)});expect(result.ok).toBe(true);expect(result.package.semanticText).toBe(expectedText);expect(result.package.model).toBeTruthy();
 });
 it.each([
  ['invalid run size',body.replace('<w:r>','<w:r><w:rPr><w:sz w:val="9999"/></w:rPr>')],
  ['unknown run attribute',body.replace('<w:r>','<w:r><w:rPr><w:b w:invented="true"/></w:rPr>')],
  ['unknown property namespace',body.replace('<w:r>','<w:r><w:rPr><q:b xmlns:q="urn:untrusted"/></w:rPr>')],
  ['dangling list reference',body.replace('<w:p>','<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="99"/></w:numPr></w:pPr>')],
 ])('refuses %s rather than certifying unsupported formatting',async(_name,inner)=>{await rejected(await fixture({xml:documentXml(inner)}));});
 it('refuses unknown section children and malformed page dimensions',async()=>{for(const xml of [documentXml(body).replace('<w:sectPr>','<w:sectPr><w:invented/>'),documentXml(body).replace('w:w="12240"','w:w="-1"')])await rejected(await fixture({xml}));});
 it('requires the actual Word main content type rather than a declaration of any kind',async()=>{await rejected(await fixture({extras:{'[Content_Types].xml':contentTypes.replace('application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml','text/plain')}}));});
});

// Owner decision transcription: refuse unsupported USED numbered paragraph
// styles, including basedOn inheritance. This does not claim a full resolver.
describe('owner-selected numbered-style refusal boundary',()=>{
 const styledFixture=async(styles,styleId='Plain')=>{
  const xml=documentXml(body.replace('<w:p>','<w:p><w:pPr><w:pStyle w:val="'+styleId+'"/></w:pPr>'));
  const types=contentTypes.replace('</Types>','<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>');
  const rel='<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>';
  return fixture({xml,extras:{'[Content_Types].xml':types,'word/styles.xml':'<w:styles xmlns:w="'+W+'">'+styles+'</w:styles>','word/_rels/document.xml.rels':rel}});
 };
 it('keeps known unnumbered paragraph style use supported',async()=>{
  const bytes=await styledFixture('<w:style w:type="paragraph" w:styleId="Plain"><w:name w:val="Plain"/><w:rPr><w:sz w:val="24"/></w:rPr></w:style>');
  expect((await validate(bytes)).ok).toBe(true);
 });
 it('keeps known unnumbered basedOn style use supported',async()=>{
  const bytes=await styledFixture('<w:style w:type="paragraph" w:styleId="Base"><w:name w:val="Base"/><w:rPr><w:sz w:val="24"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Plain"><w:name w:val="Plain"/><w:basedOn w:val="Base"/></w:style>');
  expect((await validate(bytes)).ok).toBe(true);
 });
 it.each([
  ['direct used numbered style','<w:style w:type="paragraph" w:styleId="Plain"><w:name w:val="Plain"/><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="99"/></w:numPr></w:pPr></w:style>'],
  ['basedOn inherited numbered style','<w:style w:type="paragraph" w:styleId="NumberedBase"><w:name w:val="Numbered base"/><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="99"/></w:numPr></w:pPr></w:style><w:style w:type="paragraph" w:styleId="Plain"><w:name w:val="Plain"/><w:basedOn w:val="NumberedBase"/></w:style>'],
 ])('explicitly refuses %s with no numbering definition and retains original bytes',async(_name,styles)=>{
  const bytes=await styledFixture(styles),original=Buffer.from(bytes);const result=await rejected(bytes);
  expect(result.code).toMatch(/unsupported/i);expect(result.error).toMatch(/number|style/i);expect(bytes.equals(original)).toBe(true);
 });
});

// Independent continuation: previously unmeasured default paragraph-style branch.
// No pStyle is present in the document, so these fixtures cannot accidentally
// exercise the already-covered explicit-style branch.
describe('default paragraph style numbering boundary',()=>{
 const defaultFixture=async styles=>{
  const xml=documentXml(body);
  const types=contentTypes.replace('</Types>','<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>');
  const rel='<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>';
  expect(xml).not.toContain('pStyle');
  return fixture({xml,extras:{'[Content_Types].xml':types,'word/styles.xml':'<w:styles xmlns:w="'+W+'">'+styles+'</w:styles>','word/_rels/document.xml.rels':rel}});
 };
 const numbered='<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="99"/></w:numPr></w:pPr>';
 it('refuses directly numbered default paragraph style without explicit pStyle and retains source',async()=>{
  const bytes=await defaultFixture('<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/>'+numbered+'</w:style>');
  const original=Buffer.from(bytes),result=await rejected(bytes);
  expect(result.code).toBe('unsupported-numbered-style');expect(result.error).toMatch(/number.*style|style.*number/i);expect(bytes.equals(original)).toBe(true);
 });
 it('refuses numbered basedOn ancestry of the default paragraph style without explicit pStyle and retains source',async()=>{
  const bytes=await defaultFixture('<w:style w:type="paragraph" w:styleId="Numbered"><w:name w:val="Numbered"/>'+numbered+'</w:style><w:style w:type="paragraph" w:default="true" w:styleId="Normal"><w:name w:val="Normal"/><w:basedOn w:val="Numbered"/></w:style>');
  const original=Buffer.from(bytes),result=await rejected(bytes);
  expect(result.code).toBe('unsupported-numbered-style');expect(bytes.equals(original)).toBe(true);
 });
 it('accepts unnumbered default ancestry while ignoring an unused numbered style and retains source',async()=>{
  const bytes=await defaultFixture('<w:style w:type="paragraph" w:styleId="UnusedNumbered"><w:name w:val="Unused numbered"/>'+numbered+'</w:style><w:style w:type="paragraph" w:styleId="PlainBase"><w:name w:val="Plain base"/><w:rPr><w:sz w:val="24"/></w:rPr></w:style><w:style w:type="paragraph" w:default="on" w:styleId="Normal"><w:name w:val="Normal"/><w:basedOn w:val="PlainBase"/></w:style>');
  const original=Buffer.from(bytes),result=await validate(bytes);
  expect(result.ok).toBe(true);expect(result.package.semanticText).toBe(text);expect(bytes.equals(original)).toBe(true);
 });
});