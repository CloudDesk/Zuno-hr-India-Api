import { reportHraExemption } from '../src/services/consolidated-hra-exemption';
it.each([
 [554839,277419,840000,'Chennai',277419],
 [960000,480000,840000,'Chennai',480000],
 [960000,480000,840000,'Bengaluru',384000],
 [960000,480000,200000,'Chennai',104000],
 [960000,480000,96000,'Chennai',0],
 [960000,480000,0,'Chennai',0],
 [0,0,840000,'Chennai',0],
 [480000,240000,null,'Chennai',0],
] as Array<[number,number,number|null,string,number]>)('calculates salary %s, HRA %s, rent %s and location %s as %s',(basic,hra,rent,location,expected)=>{
 expect(reportHraExemption(basic,hra,rent,location)).toBe(expected);
});
