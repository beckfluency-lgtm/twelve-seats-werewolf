import {test} from 'node:test';import assert from 'node:assert/strict';import zlib from 'node:zlib';import {zip,crc32} from '../scripts/zip.mjs';import {checkRelease} from '../scripts/check-release.mjs';
test('release inputs contain every platform preset and use only the required browser permissions',()=>{const result=checkRelease();assert.equal(result.platforms,17);assert.equal(result.version,'0.2.0');});
test('ZIP records decompress, retain UTF-8 names, checksums and offsets, and reject traversal paths',()=>{
 const entries=[{name:'twelve-seats/README.md',data:Buffer.from('中文说明')},{name:'twelve-seats/manifest.json',data:Buffer.from('{}')}],buffer=zip(entries);let offset=0;
 for(const entry of entries){assert.equal(buffer.readUInt32LE(offset),0x04034b50);assert.equal(buffer.readUInt16LE(offset+6),0x800);const size=buffer.readUInt32LE(offset+18),length=buffer.readUInt16LE(offset+26);assert.equal(buffer.subarray(offset+30,offset+30+length).toString(),entry.name);const data=zlib.inflateRawSync(buffer.subarray(offset+30+length,offset+30+length+size));assert.deepEqual(data,entry.data);assert.equal(buffer.readUInt32LE(offset+14),crc32(data));offset+=30+length+size;}
 assert.equal(buffer.readUInt32LE(offset),0x02014b50);assert.equal(buffer.readUInt32LE(buffer.length-6),offset);assert.deepEqual(zip(entries),buffer);assert.throws(()=>zip([{name:'../escape',data:''}]));
});
