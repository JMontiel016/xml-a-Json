// Conversión local: la factura y las credenciales no se envían a /api/convert.
// Todos los importes se calculan con BigInt a 8 decimales para evitar errores de float.
const SCALE=100000000n, ZERO=0n;
const read=(text,field)=>{if(text==null||text==='')return null;const s=String(text);if(!/^\d+(?:\.\d+)?$/.test(s))throw Error(`Importe inválido en ${field}: ${s}`);const [whole,fraction='']=s.split('.');if(fraction.length>8)throw Error(`${field} admite hasta 8 decimales.`);return BigInt(whole)*SCALE+BigInt(fraction.padEnd(8,'0'))};
const need=(text,field)=>{const x=read(text,field);if(x===null)throw Error(`Falta ${field} en el XML; no se puede modificar ese importe.`);return x};
const positive=(text,field)=>{const x=need(text,field);if(x<=ZERO)throw Error(`El ${field} debe ser mayor que cero.`);return x};
const divRound=(numerator,denominator)=>{if(denominator<=ZERO)throw Error('División por cero en los importes.');return (numerator+denominator/2n)/denominator};
const fixed=(x,places=8)=>{if(x===null)return '';const s=x.toString().padStart(9,'0');const whole=s.slice(0,-8),fraction=s.slice(-8);return places===8?`${whole}.${fraction}`:`${whole}.${fraction.slice(0,places)}`};
const val=(node,path)=>{for(const segment of path.split('/')){node=[...(node?.children||[])].find(child=>child.localName===segment);if(!node)return ''}return node.textContent.trim()};
const nodes=(root,name)=>[...root.getElementsByTagName('*')].filter(node=>node.localName===name);
const sum=(array)=>array.reduce((total,n)=>total+n,ZERO);
const add=(subtotal,key,amount)=>{const old=read(subtotal[key],key);subtotal[key]=old===null||amount===null?'':fixed(old+amount)};
function totalsFor(items){
 // Orden del grupo F del manual SIFEN v150. Los totales intermedios son obligatorios aun en cero.
 const keys=['dSubExe','dSubExo','dSub5','dSub10','dTotOpe',
  'dTotDesc','dTotDescGlotem','dTotAntItem','dTotAnt',
  'dPorcDescTotal','dDescTotal','dAnticipo','dRedon',
  'dTotGralOpe','dIVA5','dIVA10','dTotIVA',
  'dBaseGrav5','dBaseGrav10','dTBasGraIVA'];
 const subtotal=Object.fromEntries(keys.map(key=>[key,fixed(ZERO)]));
 subtotal.dRedon=fixed(ZERO,4); // dRedon admite hasta cuatro decimales.
 subtotal.dTotalGs='';
 for(const item of items){
  const total=read(item.dTotOpeItem,'dTotOpeItem'),gross=read(item.dTotBruOpeItem,'dTotBruOpeItem');
  const quantity=read(item.dCantProSer,'dCantProSer');read(item.dPUniProSer,'dPUniProSer');
  const base=read(item.dBasGravIVA,'dBasGravIVA'),tax=read(item.dLiqIVAItem,'dLiqIVAItem'),exempt=read(item.dBaseExe,'dBaseExe');
  if(quantity!==null&&quantity<=ZERO)throw Error('La cantidad debe ser mayor que cero.');
  if(gross!==null&&total!==null&&gross!==total)throw Error(`El producto ${item.dCodInt} tiene descuentos o anticipos. La plantilla reducida no incluye esos campos.`);
  add(subtotal,'dTotOpe',total);
  if(['2','3'].includes(item.iAfecIVA)){
   add(subtotal,item.iAfecIVA==='2'?'dSubExo':'dSubExe',total);
   if((base!==null&&base!==ZERO)||(tax!==null&&tax!==ZERO))throw Error('El ítem exento/exonerado contiene IVA distinto de cero.');
  }else if(['1','4'].includes(item.iAfecIVA)){
   const rate=read(item.dTasaIVA,'dTasaIVA');
   if(rate===null){if(item.iAfecIVA==='4')add(subtotal,'dSubExe',exempt);for(const key of ['dSub5','dSub10','dIVA5','dIVA10','dBaseGrav5','dBaseGrav10'])subtotal[key]=''}
   else{
    if(rate!==5n*SCALE&&rate!==10n*SCALE)throw Error(`Tasa IVA no compatible: ${item.dTasaIVA}`);
    const suffix=rate===5n*SCALE?'5':'10';
    let taxable=total;
    if(item.iAfecIVA==='4'){
     add(subtotal,'dSubExe',exempt);taxable=total!==null&&exempt!==null?total-exempt:null;
     if(taxable!==null&&taxable<ZERO)throw Error('La base exenta supera el total del producto.');
    }
    add(subtotal,'dSub'+suffix,taxable);add(subtotal,'dIVA'+suffix,tax);add(subtotal,'dBaseGrav'+suffix,base);
   }
  }else if(item.iAfecIVA===''){
   for(const key of ['dSubExe','dSubExo','dSub5','dSub10','dIVA5','dIVA10','dBaseGrav5','dBaseGrav10'])subtotal[key]='';
  }else throw Error(`Afectación IVA no compatible: ${item.iAfecIVA}`);
 }
 subtotal.dTotGralOpe=subtotal.dTotOpe;
 for(const [dest,a,b] of [['dTotIVA','dIVA5','dIVA10'],['dTBasGraIVA','dBaseGrav5','dBaseGrav10']]){
  const left=read(subtotal[a],a),right=read(subtotal[b],b);subtotal[dest]=left===null||right===null?'':fixed(left+right);
 }
 return subtotal;
}
function taxFor(item){
 const total=read(item.dTotOpeItem,'dTotOpeItem'),affect=item.iAfecIVA;
 if(total===null||!affect||(['1','4'].includes(affect)&&(!item.dTasaIVA||!item.dPropIVA))){Object.assign(item,{dBasGravIVA:'',dLiqIVAItem:'',dBaseExe:''});return}
 if(['2','3'].includes(affect)){Object.assign(item,{dBasGravIVA:fixed(ZERO),dLiqIVAItem:fixed(ZERO),dBaseExe:fixed(ZERO)});return}
 if(!['1','4'].includes(affect))throw Error('Falta una afectación IVA válida para recalcular el producto.');
 const rate=need(item.dTasaIVA,'tasa IVA'),prop=need(item.dPropIVA,'proporción IVA');
 if(![5n*SCALE,10n*SCALE].includes(rate)||prop<=ZERO||prop>100n*SCALE||(affect==='1'&&prop!==100n*SCALE))throw Error('Tasa o proporción IVA incompatible con la afectación.');
 const denominator=10000n*SCALE+rate*prop/SCALE;
 const base=divRound(total*100n*prop,denominator);
 const tax=affect==='1'?total-base:divRound(total*prop*rate,denominator*SCALE);
 const exempt=affect==='4'?total-base-tax:ZERO;
 if(exempt<ZERO)throw Error('El redondeo produce una base exenta negativa.');
 Object.assign(item,{dBasGravIVA:fixed(base),dLiqIVAItem:fixed(tax),dBaseExe:fixed(exempt)});
}
function partialItems(original,opts){
 if(!opts.single)return original;
 const codes=[],selected=[];
 if(!opts.code)selected.push(...original.map(item=>({...item})));
 else for(const raw of opts.code.split(';')){
  const code=raw.trim();if(!code||codes.includes(code))throw Error('Hay un código vacío o repetido en la selección.');
  const found=original.filter(item=>item.dCodInt===code);if(!found.length)throw Error(`No se encontró el código ${code}.`);
  selected.push(...found.map(item=>({...item})));codes.push(code);
 }
 if(!opts.quantity&&!opts.amount)return selected;
 totalsFor(selected);
 const quantities=opts.quantity?opts.quantity.split(';').map(s=>s.trim()):null;
 if(quantities&&![selected.length,codes.length].includes(quantities.length))throw Error(`Informá una cantidad por código o por línea seleccionada (${selected.length} líneas encontradas).`);
 if(quantities?.some(s=>!s))throw Error('Informá cada cantidad en el mismo orden que sus códigos; no dejes posiciones vacías.');
 const requested=[],limits=[];
 selected.forEach((item,index)=>{
  const oldQty=need(item.dCantProSer,'cantidad'),price=need(item.dPUniProSer,'precio'),oldTotal=need(item.dTotOpeItem,'total');
  const qstr=quantities?(quantities.length===selected.length?quantities[index]:quantities[codes.indexOf(item.dCodInt)]):'';
  const qty=qstr?positive(qstr,'cantidad'):oldQty;
  if(qty>oldQty)throw Error(`La cantidad de ${item.dCodInt} (línea ${index+1}) supera la original.`);
  if(qty%10000n!==ZERO)throw Error('La cantidad admite hasta 4 decimales.');
  const limit=qty===oldQty?oldTotal:divRound(price*qty,SCALE);
  if(limit>oldTotal)throw Error('El importe supera el original del producto.');
  requested.push(qty);limits.push(limit);
 });
 const available=sum(limits),parts=opts.amount?opts.amount.split(';').map(s=>s.trim()):[];
 if(parts.some(s=>!s))throw Error('No dejes montos vacíos entre los puntos y coma.');
 if(parts.length>1&&(!codes.length||parts.length!==codes.length))throw Error('Informá un monto por cada código, en el mismo orden, o un único monto total.');
 const targets=parts.map(s=>positive(s,'monto')),asked=targets.length?sum(targets):available;
 if(asked>available)throw Error(`El monto supera el disponible para los productos y cantidades: ${fixed(available)}`);
 const groups=selected.map(item=>targets.length>1?codes.indexOf(item.dCodInt):0);
 const budgets=targets.length>1?targets:[asked],capacities=budgets.map((_,g)=>sum(limits.filter((_,i)=>groups[i]===g)));
 budgets.forEach((budget,g)=>{if(budget>capacities[g])throw Error(`El monto del código ${codes[g]} supera su disponible: ${fixed(capacities[g])}`)});
 const cumulative=budgets.map(()=>ZERO),allocated=budgets.map(()=>ZERO),result=[];
 selected.forEach((item,index)=>{
  let total=limits[index];
  if(targets.length){const group=groups[index];cumulative[group]+=limits[index];const next=budgets[group]*cumulative[group]/capacities[group];total=next-allocated[group];allocated[group]=next;if(total===ZERO)return}
  const qty=requested[index],oldQty=need(item.dCantProSer,'cantidad'),oldTotal=need(item.dTotOpeItem,'total');
  if(qty!==oldQty||total!==oldTotal){
   const price=targets.length?divRound(total*SCALE,qty):need(item.dPUniProSer,'precio');
   if(divRound(qty*price,SCALE)!==total&&divRound(total*SCALE,qty)!==price)throw Error(`El monto de ${item.dCodInt} no coincide con cantidad × precio a 8 decimales. Ajustá monto o cantidad.`);
   Object.assign(item,{dCantProSer:fixed(qty,4),dPUniProSer:fixed(price),dTotBruOpeItem:fixed(total),dTotOpeItem:fixed(total)});
   taxFor(item);
  }
  result.push(item);
 });
 if(!result.length)throw Error('El monto no permite generar ninguna línea.');
 totalsFor(result);return result;
}
function currencyFor(header,items,totals){
 const currency=header.cMoneOpe;if(!currency||currency==='PYG')return;
 const condition=header.dCondTiCam||'';
 if(condition==='1'){
  const rate=read(header.dTiCam,'dTiCam');if(rate===null)return;if(rate<=ZERO)throw Error('La cotización debe ser mayor que cero.');
  const total=read(totals.dTotGralOpe,'dTotGralOpe');if(total!==null)totals.dTotalGs=fixed(divRound(total*rate,SCALE));
 }else if(condition==='2'){
  let converted=ZERO,missing=false;
  for(const item of items){const rate=read(item.dTiCamIt||'','dTiCamIt'),total=read(item.dTotOpeItem,'dTotOpeItem');if(rate!==null&&rate<=ZERO)throw Error('La cotización por ítem debe ser mayor que cero.');
   if(rate===null||total===null){item.dTotOpeGs='';missing=true}else{const amount=divRound(total*rate,SCALE);item.dTotOpeGs=fixed(amount);converted+=amount}}
  if(!missing)totals.dTotalGs=fixed(converted);
 }else if(condition)throw Error('Condición de tipo de cambio no compatible: '+condition);
}
// No se informan etiquetas opcionales vacías ni valores opcionales fuera de su longitud.
// Un valor obligatorio nunca se acorta ni se sustituye por otro dato.
const optionalLengths={dNomFanEmi:[4,255],dCompDir1:[1,255],dCompDir2:[1,255],
 dDirRec:[1,255],dNumCasRec:[1,6],dTelRec:[6,15],dCelRec:[10,20],
 dEmailRec:[3,80],dCodCliente:[3,15]};
const optionalHeader=new Set(['dNomFanEmi','dCompDir1','dCompDir2',
 'iTiContRec','dRucRec','dDVRec','iTipIDRec','dDTipIDRec','dNumIDRec',
 'dDirRec','dNumCasRec','cDepRec','dDesDepRec','cDisRec','dDesDisRec',
 'cCiuRec','dDesCiuRec','dTelRec','dCelRec','dEmailRec','dCodCliente']);
function cleanHeader(header){
 const omitted=[];
 for(const key of optionalHeader){
  if(!(key in header))continue;
  const value=String(header[key]??'').trim(),bounds=optionalLengths[key];
  if(!value||(bounds&&(value.length<bounds[0]||value.length>bounds[1]))){
   if(value)omitted.push(key);
   delete header[key];
  }
 }
 if(!header.dDirRec)delete header.dNumCasRec;
 return omitted;
}
export function convertXml(data){
 const opts=Object.fromEntries(['establishment','point','number','date','reason','code','quantity','amount'].map(key=>[key,String(data[key]||'').trim()]));opts.single=data.single===true;
 for(const [key,digits,label] of [['establishment',3,'Establecimiento'],['point',3,'Punto de expedición'],['number',7,'Número de NC']]){
  if(opts[key]&&!new RegExp(`^\\d{${digits}}$`).test(opts[key]))throw Error(`${label}: se requieren ${digits} dígitos.`);
 }
 if(opts.date){if(!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2})?$/.test(opts.date))throw Error('Fecha NC: usá AAAA-MM-DDThh:mm:ss.');
  const date=opts.date.slice(0,10),check=new Date(`${date}T00:00:00Z`);if(Number.isNaN(check.getTime())||check.toISOString().slice(0,10)!==date)throw Error('Fecha de NC inválida.');opts.date=date+'T00:00:00'}
 if(opts.reason&&!/^[1-8]$/.test(opts.reason))throw Error('iMotEmi debe ser un código entre 1 y 8.');
 if(opts.single&&opts.quantity&&!opts.code)throw Error('Para informar cantidades indicá los códigos correspondientes.');
 let xml=String(data.xml||'').trim().replace(/^\uFEFF/,'').trim();const notice='This XML file does not appear to have any style information associated with it. The document tree is shown below.';
 if(xml.startsWith(notice))xml=xml.slice(notice.length).trim();
 xml=xml.replace(/&(?!(?:amp|lt|gt|quot|apos|#[0-9]+|#x[0-9a-fA-F]+);)/g,'&amp;').replace(/^<\?xml\s+.*?\?>/s,'');
 if(!xml)throw Error('La entrada está vacía.');if(/<!DOCTYPE|<!ENTITY/i.test(xml))throw Error('El XML no puede contener DTD ni entidades externas.');
 const doc=new DOMParser().parseFromString('<conversion-root>'+xml+'</conversion-root>','application/xml');
 if(doc.getElementsByTagName('parsererror').length)throw Error('XML inválido. Revisá el contenido de la factura.');
 const documents=nodes(doc,'DE');if(documents.length!==1)throw Error('Pegá un solo documento DE completo.');
 const de=documents[0];if(val(de,'gTimb/iTiDE')!=='1')throw Error('El XML de origen debe ser una factura electrónica (iTiDE=1).');
 const cdc=de.getAttribute('Id')||'';if(cdc&&!/^\d{44}$/.test(cdc))throw Error('El CDC de la factura debe tener 44 dígitos.');
 const header={iTiDE:'5',dEst:opts.establishment,dPunExp:opts.point,dNumDoc:opts.number,dFeEmiDE:opts.date,iTImp:val(de,'gDatGralOpe/gOpeCom/iTImp')};
 const currency=val(de,'gDatGralOpe/gOpeCom/cMoneOpe');header.cMoneOpe=currency;
 if(currency&&currency!=='PYG'){header.dCondTiCam=val(de,'gDatGralOpe/gOpeCom/dCondTiCam');if(header.dCondTiCam!=='2')header.dTiCam=val(de,'gDatGralOpe/gOpeCom/dTiCam')}
 for(const key of ['dRucEm','dDVEmi','iTipCont','dNomEmi','dDirEmi','dNumCas','cDepEmi','dDesDepEmi','cDisEmi','dDesDisEmi','cCiuEmi','dDesCiuEmi'])header[key]=val(de,'gDatGralOpe/gEmis/'+key);
 for(const key of ['dNomFanEmi','dCompDir1','dCompDir2','dTelEmi','dEmailE']){const text=val(de,'gDatGralOpe/gEmis/'+key);if(text)header[key]=text}
 for(const key of ['iNatRec','iTiOpe','cPaisRec','iTiContRec','dRucRec','dDVRec'])header[key]=val(de,'gDatGralOpe/gDatRec/'+key);
 if(header.iNatRec==='2')for(const key of ['iTipIDRec','dDTipIDRec','dNumIDRec'])header[key]=val(de,'gDatGralOpe/gDatRec/'+key);
 for(const key of ['dNomRec','dDirRec','dNumCasRec'])header[key]=val(de,'gDatGralOpe/gDatRec/'+key);
 for(const key of ['cDepRec','dDesDepRec','cDisRec','dDesDisRec','cCiuRec','dDesCiuRec']){const text=val(de,'gDatGralOpe/gDatRec/'+key);if(text)header[key]=text}
 for(const key of ['dTelRec','dCelRec','dEmailRec','dCodCliente'])header[key]=val(de,'gDatGralOpe/gDatRec/'+key);
 header.iMotEmi=opts.reason;
 header.dDesMotEmi=opts.reason?['Devolución y Ajuste de precios','Devolución','Descuento','Bonificación','Crédito incobrable','Recupero de costo','Recupero de gasto','Ajuste de precio'][Number(opts.reason)-1]:'';
 const items=nodes(de,'gCamItem').map(element=>{
  const paths={dCodInt:'dCodInt',dDesProSer:'dDesProSer',cUniMed:'cUniMed',dCantProSer:'dCantProSer',dPUniProSer:'gValorItem/dPUniProSer',dTotBruOpeItem:'gValorItem/dTotBruOpeItem',dTotOpeItem:'gValorItem/gValorRestaItem/dTotOpeItem',iAfecIVA:'gCamIVA/iAfecIVA',dPropIVA:'gCamIVA/dPropIVA',dTasaIVA:'gCamIVA/dTasaIVA',dBasGravIVA:'gCamIVA/dBasGravIVA',dLiqIVAItem:'gCamIVA/dLiqIVAItem',dBaseExe:'gCamIVA/dBasExe'};
  const item=Object.fromEntries(Object.entries(paths).map(([key,path])=>[key,val(element,path)]));
  if(currency&&currency!=='PYG'&&header.dCondTiCam==='2')item.dTiCamIt=val(element,'gValorItem/dTiCamIt');return item;
 });
 if(!items.length)throw Error('El XML no contiene productos.');const selected=partialItems(items,opts);
 for(const key of ['dRedon','dComi','dIVAComi']){const field=val(de,'gTotSub/'+key);if(field&&read(field,key)!==ZERO)throw Error(`La factura contiene ${key}. Esta plantilla reducida requiere revisar ese ajuste.`)}
 const totals=totalsFor(selected);currencyFor(header,selected,totals);
 const omitted=cleanHeader(header);
 if(!totals.dTotalGs)delete totals.dTotalGs;
 for(const item of selected)if(!item.dTiCamIt)delete item.dTiCamIt;
 let summary=`Moneda: ${currency||'sin informar'} | Total NC: ${totals.dTotGralOpe} | IVA 5%: ${totals.dIVA5} | IVA 10%: ${totals.dIVA10}`;
 if(currency&&currency!=='PYG'){const rate=header.dCondTiCam==='2'?'por ítem':header.dTiCam||'';summary+=` | Cambio: ${rate} | Total Gs: ${totals.dTotalGs||'pendiente: faltan datos de cambio/importes'}`}
 if(omitted.length)summary+=` | Campos opcionales omitidos por longitud: ${omitted.join(', ')}`;
 const result={...header,Detalles:selected,Subtotales:[totals],DocumentosAsociados:[{iTipDocAso:'1',dCdCDERef:cdc}]};
 return {json:JSON.stringify(result,null,4),count:selected.length,summary};
}
