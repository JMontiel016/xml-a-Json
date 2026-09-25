import React, {useEffect, useMemo, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import './style.css';
import {convertXml} from './conversion.js';

const reasons=['Devolución y Ajuste de precios','Devolución','Descuento','Bonificación','Crédito incobrable','Recupero de costo','Recupero de gasto','Ajuste de precio'];

const todayAtMidnight=()=>{
  const now=new Date();
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}T00:00:00`;
};

const initial=()=>({
  establishment:'',
  point:'',
  number:'',
  date:todayAtMidnight(),
  reason:'',
  single:false,
  code:'',
  quantity:'',
  amount:''
});

// Lee el emisor únicamente del XML para evitar mezclar credenciales entre empresas.
const issuerOf=text=>
  String(text||'').match(/<(?:[\w.-]+:)?dRucEm>\s*(\d+)\s*<\/(?:[\w.-]+:)?dRucEm>/)?.[1]||'';

// Estos campos pertenecen al emisor y no se incluyen en el JSON generado.
const issuerFields=[
  'dRucEm','dDVEmi','iTipCont','dNomEmi','dNomFanEmi',
  'dDirEmi','dNumCas','cDepEmi','dDesDepEmi',
  'cDisEmi','dDesDisEmi','cCiuEmi','dDesCiuEmi',
  'dCompDir1','dCompDir2','dTelEmi','dEmailE'
];

const withoutIssuer=text=>{
  const data=JSON.parse(text);
  for(const field of issuerFields)delete data[field];
  return JSON.stringify(data,null,4);
};

const explainService=(content,status)=>{
  let parsed;
  try{parsed=JSON.parse(content)}catch{}

  if(parsed&&typeof parsed==='object'){
    const descriptions=[];

    const visit=(node,depth=0)=>{
      if(node==null||depth>5||descriptions.length>=15)return;

      if(typeof node==='string'){
        const value=node.trim();
        if(!value)return;

        if(value.startsWith('{')||value.startsWith('[')){
          try{
            visit(JSON.parse(value),depth+1);
            return;
          }catch{}
        }

        descriptions.push(value.slice(0,350));
        return;
      }

      if(Array.isArray(node)){
        node.forEach(value=>visit(value,depth+1));
        return;
      }

      if(typeof node==='object'){
        const fields=[
          'message','mensaje','error','descripcion',
          'detail','details','errors','validationErrors','body'
        ];
        let found=false;

        for(const field of fields){
          if(node[field]!=null){
            found=true;
            visit(node[field],depth+1);
          }
        }

        if(!found){
          for(const [key,value] of Object.entries(node)){
            if([
              'status','code','timestamp','path',
              'token','access_token','password','authorization'
            ].includes(key.toLowerCase()))continue;

            if(typeof value==='string'||Array.isArray(value)||typeof value==='object'){
              visit(value,depth+1);
            }
          }
        }
      }
    };

    visit(parsed);

    const safe=[...new Set(descriptions)].filter(
      value=>!/(?:eyJ[A-Za-z0-9_-]{30,}|bearer\s+\S+|"(?:token|password|access_token)"\s*:)/i.test(value)
    );

    return `HTTP ${status}\n${safe.length?safe.join('\n'):'El servicio rechazó el documento sin explicar el motivo.'}`;
  }

  const plain=String(content||'').trim();
  const safe=plain&&!/(?:eyJ[A-Za-z0-9_-]{30,}|"(?:token|password)"\s*:)/i.test(plain);

  return `HTTP ${status}\n${safe?plain.slice(0,500):'El servicio respondió sin un mensaje legible.'}`;
};

function App(){
  const [options,setOptions]=useState(initial);
  const [xml,setXml]=useState('');
  const [json,setJson]=useState('');
  const [summary,setSummary]=useState('');
  const [status,setStatus]=useState('Seleccione una factura XML o TXT para comenzar.');
  const [busy,setBusy]=useState(false);

  const [files,setFiles]=useState([]);
  const [selected,setSelected]=useState('');
  const [filter,setFilter]=useState('');
  const [view,setView]=useState('todos');
  const [done,setDone]=useState({});

  const [query,setQuery]=useState('');
  const [replacement,setReplacement]=useState('');
  const [match,setMatch]=useState(0);
  const [tab,setTab]=useState('convertir');

  const [authUrl,setAuthUrl]=useState('');
  const [sendUrl,setSendUrl]=useState('');
  const [credentials,setCredentials]=useState('{\n  "ruc": "",\n  "password": ""\n}');
  const [token,setToken]=useState('');
  const [payload,setPayload]=useState('');
  const [response,setResponse]=useState('');

  const editor=useRef(null);
  const highlight=useRef(null);
  const activeHighlight=useRef(null);
  const folder=useRef(null);
  const singleFile=useRef(null);
  const requestId=useRef(0);
  const integrationId=useRef(0);

  useEffect(()=>{
    if(!xml.trim())return;
    const timer=setTimeout(()=>convert(),600);
    return()=>clearTimeout(timer);
  },[xml,options]);

  const update=(key,value)=>{
    requestId.current++;
    setOptions(prev=>({...prev,[key]:value}));
    setJson('');
    setPayload('');
    setSummary('');
  };

  const clearClient=()=>{
    integrationId.current++;
    setAuthUrl('');
    setSendUrl('');
    setCredentials('{\n  "ruc": "",\n  "password": ""\n}');
    setToken('');
    setResponse('');
    setPayload('');
  };

  const load=file=>{
    if(!file)return;
    requestId.current++;

    const reader=new FileReader();

    reader.onload=()=>{
      const content=String(reader.result).replace(/^\uFEFF/,'');
      const previous=issuerOf(xml);
      const next=issuerOf(content);

      if(previous&&next&&previous!==next)clearClient();
      if(selected!==(file.webkitRelativePath||file.name))setOptions(initial());

      setXml(content);
      setJson('');
      setPayload('');
      setResponse('');
      setSummary('');
      setQuery('');
      setSelected(file.webkitRelativePath||file.name);
      setStatus(`Factura cargada: ${file.name}. Se generará la nota de crédito.`);
    };

    reader.onerror=()=>setStatus('No se pudo leer el archivo seleccionado.');
    reader.readAsText(file,'UTF-8');
  };

  const importFiles=list=>{
    const incoming=[...list]
      .filter(file=>/\.(xml|txt)$/i.test(file.name))
      .sort((a,b)=>a.name.localeCompare(b.name));

    setFiles(incoming);
    setDone({});
    setFilter('');
    setView('todos');

    if(incoming.length)load(incoming[0]);
    else setStatus('La selección no contiene archivos XML o TXT.');
  };

  const visible=useMemo(
    ()=>files.filter(file=>
      file.name.toLowerCase().includes(filter.toLowerCase())&&
      (view==='todos'||(
        view==='realizados'
          ?!!done[file.webkitRelativePath||file.name]
          :!done[file.webkitRelativePath||file.name]
      ))
    ),
    [files,filter,view,done]
  );

  const matches=useMemo(()=>{
    if(!query||!json)return [];

    const found=[];
    let at=0;

    while((at=json.toLowerCase().indexOf(query.toLowerCase(),at))!==-1){
      found.push(at);
      at+=Math.max(query.length,1);
    }

    return found;
  },[json,query]);

  const jump=index=>{
    if(!matches.length)return;

    const next=(index+matches.length)%matches.length;
    setMatch(next);

    requestAnimationFrame(()=>{
      activeHighlight.current?.scrollIntoView({
        block:'nearest',
        inline:'nearest'
      });

      if(editor.current&&highlight.current){
        editor.current.scrollTop=highlight.current.scrollTop;
        editor.current.scrollLeft=highlight.current.scrollLeft;
      }
    });
  };

  const replaceMatch=all=>{
    if(!query||!matches.length)return;

    const start=matches[Math.min(match,matches.length-1)];

    const updated=all
      ?matches.reduceRight(
        (value,at)=>value.slice(0,at)+replacement+value.slice(at+query.length),
        json
      )
      :json.slice(0,start)+replacement+json.slice(start+query.length);

    setJson(updated);
    setPayload('');
    setMatch(0);
    setStatus(
      all
        ?`${matches.length} coincidencia(s) reemplazada(s). Revise el JSON antes de enviarlo.`
        :'Coincidencia reemplazada. Revise el JSON antes de enviarlo.'
    );
  };

  const highlighted=useMemo(()=>{
    if(!json)return null;
    if(!query||!matches.length)return json;

    const parts=[];
    let previous=0;

    matches.forEach((at,index)=>{
      parts.push(json.slice(previous,at));
      parts.push(
        <mark
          key={at}
          ref={index===Math.min(match,matches.length-1)?activeHighlight:null}
          className={index===Math.min(match,matches.length-1)?'current':''}
        >
          {json.slice(at,at+query.length)}
        </mark>
      );
      previous=at+query.length;
    });

    parts.push(json.slice(previous));
    return parts;
  },[json,query,matches,match]);

  function convert(){
    const id=++requestId.current;

    setBusy(true);
    setStatus('Generando la nota de crédito…');

    try{
      const body=convertXml({...options,xml});
      if(id!==requestId.current)return;

      setJson(withoutIssuer(body.json));
      setPayload('');
      setSummary(`${body.count} producto(s) · ${body.summary}`);
      setStatus(
        options.number&&options.date
          ?'Nota de crédito generada. Verifique los datos antes de enviarla.'
          :'Borrador generado. Complete el número de NC antes de enviarla.'
      );
      setMatch(0);
    }catch(error){
      if(id!==requestId.current)return;
      setJson('');
      setStatus(error.message);
    }finally{
      if(id===requestId.current)setBusy(false);
    }
  }

  const download=extension=>{
    const blob=new Blob([json],{type:'text/plain;charset=utf-8'});
    const url=URL.createObjectURL(blob);
    const link=document.createElement('a');

    link.href=url;
    link.download=`NC_${options.number||'resultado'}.${extension}`;
    link.click();

    setTimeout(()=>URL.revokeObjectURL(url),1000);
  };

  const copy=async value=>{
    try{
      await navigator.clipboard.writeText(value);
      setStatus('Contenido copiado al portapapeles.');
    }catch{
      setStatus('No se pudo copiar. Seleccione el texto y use Ctrl+C.');
    }
  };

  function extractToken(value){
    let raw=value.trim();

    if(!raw)throw Error('Obtenga o pegue un token antes de enviar la nota de crédito.');

    if(raw.startsWith('{')||raw.startsWith('[')){
      let parsed;

      try{
        parsed=JSON.parse(raw);
      }catch{
        throw Error('La respuesta del token no es un JSON válido.');
      }

      const found=[];

      const scan=node=>{
        if(Array.isArray(node))return node.forEach(scan);
        if(!node||typeof node!=='object')return;

        Object.entries(node).forEach(([key,val])=>{
          if(
            ['token','access_token','accesstoken','bearer','jwt'].includes(key.toLowerCase())&&
            typeof val==='string'&&val.trim()
          ){
            found.push(val.trim());
          }else if(val&&typeof val==='object'){
            scan(val);
          }
        });
      };

      scan(parsed);
      const unique=[...new Set(found)];

      if(unique.length!==1){
        throw Error('La respuesta no contiene un token único. Revise el contenido de la respuesta.');
      }

      raw=unique[0];
    }

    raw=raw.replace(/^Bearer\s+/i,'').trim();

    if(!/^[A-Za-z0-9._~+\/=-]+$/.test(raw)){
      throw Error('El token recibido tiene un formato inválido.');
    }

    return raw;
  }

  async function send(auth){
    const currentIntegration=integrationId.current;

    try{
      let url;

      try{
        url=new URL(auth?authUrl:sendUrl);
      }catch{
        throw Error('Ingrese la URL del servicio antes de continuar.');
      }

      if(url.protocol!=='https:'||url.username||url.password){
        throw Error('Ingrese una URL HTTPS válida para la integración.');
      }

      const body=auth?credentials:payload;
      let parsed;

      try{
        parsed=JSON.parse(body);
      }catch{
        throw Error(
          auth
            ?'Corrija el JSON de acceso antes de solicitar el token.'
            :'Corrija el JSON de la nota de crédito antes de enviarla.'
        );
      }

      if(!parsed||Array.isArray(parsed)||typeof parsed!=='object'){
        throw Error('El documento debe contener un objeto JSON válido.');
      }

      if(auth&&(!parsed.ruc||!parsed.password)){
        throw Error('Complete el RUC y la contraseña en el JSON de acceso.');
      }

      if(!auth){
        if(issuerFields.some(field=>Object.hasOwn(parsed,field))){
          throw Error(
            'El documento cargado contiene datos del emisor. Genere de nuevo la NC y pulse «Cargar nota de crédito generada».'
          );
        }

        for(const [key,digits] of [
          ['dEst',3],['dPunExp',3],['dNumDoc',7]
        ]){
          if(!new RegExp(`^\\d{${digits}}$`).test(String(parsed[key]||''))){
            throw Error(`Revise ${key}: debe contener ${digits} dígitos antes de enviar.`);
          }
        }

        if(!/^[1-8]$/.test(String(parsed.iMotEmi||''))){
          throw Error('Seleccione el motivo de emisión antes de enviar.');
        }

        if(!Array.isArray(parsed.Detalles)||!parsed.Detalles.length){
          throw Error('El JSON para enviar no contiene productos.');
        }

        const totals=parsed.Subtotales?.[0];
        const required=[
          'dTotOpe','dTotDesc','dTotDescGlotem',
          'dTotAntItem','dTotAnt','dPorcDescTotal',
          'dDescTotal','dAnticipo','dRedon','dTotGralOpe'
        ];

        if(!totals){
          throw Error(
            'El JSON no contiene subtotales. Genere nuevamente la nota de crédito.'
          );
        }

        // Acepta números JSON y textos numéricos, incluidos los valores cero.
        const missing=required.filter(
          key=>!/^\d+(?:\.\d+)?$/.test(String(totals[key]??''))
        );

        if(missing.length){
          throw Error(
            `Faltan subtotales: ${missing.join(', ')}. Genere la nota de crédito y vuelva a pulsar «Cargar nota de crédito generada».`
          );
        }
      }

      const bearer=auth?'':extractToken(token);

      setBusy(true);
      setResponse(auth?'Solicitando token…':'Enviando nota de crédito…');

      if(auth)setToken('');

      let res;

      try{
        res=await fetch('/api/send',{
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({
            url:url.href,
            body,
            token:bearer
          })
        });
      }catch{
        throw Error(
          'No se pudo conectar con la API de integración. Revise la terminal de Vite.'
        );
      }

      const raw=await res.text();
      let result;

      try{
        result=JSON.parse(raw);
      }catch{
        throw Error(
          `La API de integración devolvió HTTP ${res.status} sin una respuesta JSON válida. Revise la terminal de Vite.`
        );
      }

      if(currentIntegration!==integrationId.current)return;

      if(!res.ok){
        throw Error(result.error||`La API de integración respondió HTTP ${res.status}.`);
      }

      const content=typeof result.body==='string'?result.body:'';

      if(result.status<200||result.status>=300){
        setResponse(explainService(content,result.status));
        setStatus(`El servicio devolvió HTTP ${result.status}. Revise la respuesta.`);
        return;
      }

      if(auth){
        const access=extractToken(content);
        setToken(access);
        setResponse(
          'Token obtenido correctamente. Ya puede revisar y enviar la nota de crédito.'
        );
        setStatus('Token obtenido. Revise el JSON y luego envíe la nota de crédito.');
      }else{
        setResponse(explainService(content,result.status));
        setStatus('Respuesta recibida. Revise el resultado del servicio.');
      }
    }catch(error){
      if(currentIntegration===integrationId.current){
        setResponse(`No se completó la solicitud.\n${error.message}`);
        setStatus('Revise la respuesta del servicio.');
      }
    }finally{
      setBusy(false);
    }
  }

  return (
    <div className="app">
      <header>
        <div>
          <span className="eyebrow">FACTURACIÓN ELECTRÓNICA</span>
          <h1>Generador de notas de crédito</h1>
          <p>
            Cargue una factura electrónica, complete los datos de la nota de crédito
            y revise el documento antes de enviarlo.
          </p>
        </div>

        <div className="tabs">
          <button
            className={tab==='convertir'?'active':''}
            onClick={()=>setTab('convertir')}
          >
            Crear nota de crédito
          </button>
          <button
            className={tab==='envio'?'active':''}
            onClick={()=>setTab('envio')}
          >
            Integración y envío
          </button>
        </div>
      </header>

      {tab==='convertir'?(
        <main>
          <aside className="card folder">
            <div className="title">
              <h2>Facturas disponibles</h2>
              <span>{files.length} archivos XML/TXT</span>
            </div>

            <button className="secondary full" onClick={()=>folder.current?.click()}>
              Seleccionar carpeta
            </button>
            <input
              ref={folder}
              hidden
              type="file"
              webkitdirectory=""
              directory=""
              multiple
              onChange={e=>importFiles(e.target.files)}
            />

            <button className="secondary full" onClick={()=>singleFile.current?.click()}>
              Seleccionar archivo XML/TXT
            </button>
            <input
              ref={singleFile}
              hidden
              type="file"
              accept=".xml,.txt,text/xml,text/plain"
              onChange={e=>importFiles(e.target.files)}
            />

            <input
              placeholder="Buscar factura por nombre…"
              value={filter}
              onChange={e=>setFilter(e.target.value)}
            />

            <div className="segmented">
              {['todos','pendientes','realizados'].map(value=>(
                <button
                  key={value}
                  className={view===value?'active':''}
                  onClick={()=>setView(value)}
                >
                  {value}
                </button>
              ))}
            </div>

            <div className="filelist">
              {visible.map((file,index)=>{
                const name=file.webkitRelativePath||file.name;
                return (
                  <div
                    className={'file '+(selected===name?'selected':'')}
                    key={name+index}
                  >
                    <button title={name} onClick={()=>load(file)}>
                      {file.name}
                    </button>
                    <label title="Marcar realizado">
                      <input
                        type="checkbox"
                        checked={!!done[name]}
                        onChange={e=>setDone(prev=>({
                          ...prev,
                          [name]:e.target.checked
                        }))}
                      /> ✓
                    </label>
                  </div>
                );
              })}
              {!visible.length&&(
                <small>No se encontraron facturas para este filtro.</small>
              )}
            </div>

            <small>
              La carpeta muestra únicamente archivos XML y TXT.
              Seleccione una factura para generar la nota de crédito.
            </small>
          </aside>

          <section className="work">
            <div className="card">
              <div className="title">
                <h2>01 · Factura electrónica de origen</h2>
                <button
                  className="secondary"
                  onClick={()=>{
                    requestId.current++;
                    setXml('');
                    setJson('');
                    setSummary('');
                    setSelected('');
                    setOptions(initial());
                    setQuery('');
                    clearClient();
                    setStatus(
                      'Se limpiaron los datos de la factura y de la integración.'
                    );
                  }}
                >
                  Limpiar
                </button>
              </div>

              <textarea
                className="xml"
                spellCheck="false"
                placeholder="Pegue aquí el XML completo de la factura electrónica…"
                value={xml}
                onChange={e=>{
                  requestId.current++;
                  const next=e.target.value;
                  const oldIssuer=issuerOf(xml);
                  const newIssuer=issuerOf(next);

                  if(oldIssuer&&newIssuer&&oldIssuer!==newIssuer){
                    clearClient();
                  }

                  setXml(next);
                  setJson('');
                  setPayload('');
                  setSummary('');
                }}
              />

              <small>
                {selected||'Puede pegar el XML completo o seleccionar un archivo XML/TXT.'}
              </small>
            </div>

            <div className="card">
              <h2>02 · Datos de la nota de crédito</h2>
              <p className="hint">
                Ingrese el establecimiento, punto de expedición y número.
                La fecha se completa con el día de hoy a las 00:00:00.
              </p>

              <div className="grid">
                {[
                  ['establishment','Establecimiento','001'],
                  ['point','Punto de expedición','001'],
                  ['number','Número de nota de crédito (7 dígitos)','0000001'],
                  ['date','Fecha y hora de emisión','AAAA-MM-DDT00:00:00']
                ].map(([key,label,placeholder])=>(
                  <label key={key}>
                    {label}
                    <input
                      type={key==='date'?'date':'text'}
                      placeholder={placeholder}
                      value={key==='date'?options.date.slice(0,10):options[key]}
                      inputMode={key==='date'?'text':'numeric'}
                      maxLength={
                        key==='date'
                          ?undefined
                          :key==='number'?7:3
                      }
                      onChange={e=>update(
                        key,
                        key==='date'
                          ?(e.target.value
                            ?e.target.value+'T00:00:00'
                            :todayAtMidnight())
                          :e.target.value.replace(/\D/g,'')
                            .slice(0,key==='number'?7:3)
                      )}
                    />
                    {key==='date'&&<small>Hora fija: T00:00:00</small>}
                  </label>
                ))}

                <label className="wide">
                  Motivo de emisión
                  <select
                    value={options.reason}
                    onChange={e=>update('reason',e.target.value)}
                  >
                    <option value="">Seleccione un motivo</option>
                    {reasons.map((reason,index)=>(
                      <option key={reason} value={index+1}>
                        {index+1} · {reason}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="check">
                <input
                  type="checkbox"
                  checked={options.single}
                  onChange={e=>update('single',e.target.checked)}
                />
                Nota de crédito parcial
              </label>

              {options.single&&(
                <div className="grid">
                  <label>
                    Códigos de productos (separados por ;)
                    <input
                      value={options.code}
                      placeholder="682;510"
                      onChange={e=>update('code',e.target.value)}
                    />
                  </label>

                  <label>
                    Cantidades por producto (separadas por ;)
                    <input
                      value={options.quantity}
                      placeholder="1;2"
                      onChange={e=>update('quantity',e.target.value)}
                    />
                  </label>

                  <label className="wide">
                    Monto total o montos por código en el mismo orden
                    <input
                      value={options.amount}
                      placeholder="15000 o 5000;6000;4000"
                      onChange={e=>update('amount',e.target.value)}
                    />
                  </label>
                </div>
              )}

              <button
                className="primary full"
                disabled={busy||!xml.trim()}
                onClick={convert}
              >
                {busy?'Generando…':'Generar nota de crédito'}
              </button>
            </div>

            <div className="card">
              <div className="title">
                <h2>03 · Documento JSON generado</h2>
                <div className="actions">
                  <button disabled={!json} onClick={()=>copy(json)}>
                    Copiar JSON
                  </button>
                  <button disabled={!json} onClick={()=>download('json')}>
                    Guardar JSON
                  </button>
                  <button disabled={!json} onClick={()=>download('txt')}>
                    Guardar TXT
                  </button>
                </div>
              </div>

              <div className="search-tools">
                <div className="search">
                  <input
                    aria-label="Buscar en el JSON"
                    placeholder="Buscar campo o valor en el JSON…"
                    value={query}
                    onChange={e=>{
                      setQuery(e.target.value);
                      setMatch(0);
                    }}
                    onKeyDown={e=>{
                      if(e.key==='Enter'){
                        e.preventDefault();
                        jump(match+(e.shiftKey?-1:1));
                      }
                    }}
                  />
                  <span>
                    {matches.length
                      ?`${Math.min(match+1,matches.length)} de ${matches.length}`
                      :'0 resultados'}
                  </span>
                  <button
                    type="button"
                    title="Coincidencia anterior"
                    aria-label="Coincidencia anterior"
                    disabled={!matches.length}
                    onClick={()=>jump(match-1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    title="Coincidencia siguiente"
                    aria-label="Coincidencia siguiente"
                    disabled={!matches.length}
                    onClick={()=>jump(match+1)}
                  >
                    ↓
                  </button>
                </div>

                <div className="replace">
                  <input
                    aria-label="Texto de reemplazo"
                    placeholder="Reemplazar por…"
                    value={replacement}
                    onChange={e=>setReplacement(e.target.value)}
                  />
                  <button
                    type="button"
                    disabled={!matches.length}
                    onClick={()=>replaceMatch(false)}
                  >
                    Reemplazar
                  </button>
                  <button
                    type="button"
                    disabled={!matches.length}
                    onClick={()=>replaceMatch(true)}
                  >
                    Reemplazar todo
                  </button>
                </div>
              </div>

              <div className="json-editor">
                <pre
                  ref={highlight}
                  className="json-highlight"
                  aria-hidden="true"
                >
                  {highlighted||' '}
                  {'\n'}
                </pre>
                <textarea
                  ref={editor}
                  className="output"
                  spellCheck="false"
                  value={json}
                  onScroll={e=>{
                    if(highlight.current){
                      highlight.current.scrollTop=e.currentTarget.scrollTop;
                      highlight.current.scrollLeft=e.currentTarget.scrollLeft;
                    }
                  }}
                  onChange={e=>{
                    setJson(e.target.value);
                    setPayload('');
                    setMatch(0);
                  }}
                  placeholder="El documento JSON aparecerá aquí después de cargar una factura."
                />
              </div>

              <small>
                {summary||'Use la búsqueda para localizar y revisar campos del documento.'}
              </small>
            </div>
          </section>
        </main>
      ):(
        <div className="sendgrid">
          <div className="card">
            <h2>01 · Autenticación</h2>
            <p className="hint">
              Ingrese la URL y las credenciales del servicio para obtener
              el token de acceso.
            </p>

            <label>
              URL de autenticación del servicio
              <input
                value={authUrl}
                onChange={e=>{
                  integrationId.current++;
                  setAuthUrl(e.target.value);
                  setToken('');
                  setResponse('');
                }}
                placeholder="https://su-servidor.com.py/api/autenticate"
              />
            </label>

            <label>
              Datos de acceso (JSON)
              <textarea
                value={credentials}
                onChange={e=>{
                  integrationId.current++;
                  setCredentials(e.target.value);
                  setToken('');
                  setResponse('');
                }}
              />
            </label>

            <button
              className="primary"
              disabled={busy}
              onClick={()=>send(true)}
            >
              Obtener token
            </button>

            <label>
              Token de acceso
              <textarea
                value={token}
                onChange={e=>setToken(e.target.value)}
              />
            </label>

            <div className="actions">
              <button onClick={()=>{
                try{
                  setToken(extractToken(token));
                  setStatus('Token de acceso obtenido correctamente.');
                }catch(error){
                  setResponse(error.message);
                  setStatus('Revise la respuesta del servicio.');
                }
              }}>
                Extraer token
              </button>
              <button onClick={()=>copy(token)}>Copiar token</button>
            </div>
          </div>

          <div className="card">
            <h2>02 · Envío de nota de crédito</h2>
            <p className="hint">
              Cargue el JSON generado cuando esté listo para revisarlo y enviarlo.
            </p>

            <label>
              URL de envío del servicio
              <input
                value={sendUrl}
                onChange={e=>{
                  integrationId.current++;
                  setSendUrl(e.target.value);
                  setResponse('');
                }}
                placeholder="https://su-servidor.com.py/api/operation"
              />
            </label>

            <button
              disabled={!json}
              onClick={()=>{
                try{
                  setPayload(withoutIssuer(json));
                  setResponse('');
                }catch{
                  setResponse(
                    'El JSON generado no es válido. Corríjalo antes de cargarlo.'
                  );
                }
              }}
            >
              Cargar nota de crédito generada
            </button>

            <label>
              Documento JSON para enviar
              <textarea
                className="payload"
                value={payload}
                onChange={e=>setPayload(e.target.value)}
              />
            </label>

            <button
              className="primary"
              disabled={busy||!payload||!token.trim()}
              onClick={()=>send(false)}
            >
              Enviar nota de crédito
            </button>
          </div>

          <div className="card">
            <h2>03 · Respuesta del servicio</h2>
            <p className="hint">
              Aquí verá el resultado del token o del envío, incluidos los errores.
            </p>

            <textarea
              className="payload"
              readOnly
              value={response}
            />
            <button onClick={()=>copy(response)}>
              Copiar respuesta
            </button>
            <small>
              Revise el mensaje del servicio para confirmar si aceptó
              la nota de crédito.
            </small>
          </div>
        </div>
      )}

      <div className="status" role="status">
        {status}
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App/>);