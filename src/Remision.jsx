import React, {useMemo, useState} from 'react';
import {buildRemision, MOTIVOS_REMISION, parseFacturaXml, validateRemisionSources} from './remision.js';
import './remision.css';

const day = () => {
  const date = new Date();
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')].join('-');
};
const defaultForm = () => ({
  establishment: '', point: '', number: '', issueDate: day(),
  issueTime: new Date().toTimeString().slice(0, 8),
  motivo: '1', otherReason: '', km: '',
  startDate: day(), endDate: day(),
  carrierType: '1', freightResponsible: '1',
  salAddress: '', salHouse: '0', salDepartment: '', salDistrict: '', salCity: '',
  entAddress: '', entHouse: '0', entDepartment: '', entDistrict: '', entCity: '',
  vehicleType: '', vehicleBrand: '', plate: '',
  transporterName: '', transporterRuc: '', transporterDv: '', transporterAddress: '',
  driverName: '', driverDoc: '', driverAddress: ''
});
const originDefaults = invoice => ({
  salAddress: invoice.issuer.dDirEmi || '',
  salHouse: invoice.issuer.dNumCas || '0',
  salDepartment: invoice.issuer.cDepEmi || '',
  salDistrict: invoice.issuer.cDisEmi || '',
  salCity: invoice.issuer.cCiuEmi || '',
  entAddress: invoice.receptor.dDirRec || '',
  entHouse: invoice.receptor.dNumCasRec || '0',
  entDepartment: invoice.receptor.cDepRec || '',
  entDistrict: invoice.receptor.cDisRec || '',
  entCity: invoice.receptor.cCiuRec || '',
  transporterName: invoice.issuer.dNomEmi || '',
  transporterRuc: invoice.issuer.dRucEm || '',
  transporterDv: invoice.issuer.dDVEmi || '',
  transporterAddress: invoice.issuer.dDirEmi || ''
});
const fields = [
  ['establishment', 'Establecimiento (3 dígitos)', '001'],
  ['point', 'Punto expedición (3 dígitos)', '001'],
  ['number', 'Número de NR (7 dígitos)', '0000001'],
  ['km', 'Kilómetros estimados', '15'],
  ['issueDate', 'Fecha de emisión', ''],
  ['issueTime', 'Hora de emisión', ''],
  ['startDate', 'Inicio del traslado', ''],
  ['endDate', 'Fin del traslado', '']
];
const locations = [
  ['sal', 'Punto de salida'], ['ent', 'Punto de entrega']
];
const locationFields = [
  ['Address', 'Dirección'], ['House', 'Número de casa'],
  ['Department', 'Departamento (código)'], ['District', 'Distrito (código)'],
  ['City', 'Ciudad (código)']
];
const moreFields = [
  ['vehicleType', 'Tipo de vehículo', 'CAMIÓN'],
  ['vehicleBrand', 'Marca del vehículo', ''],
  ['plate', 'Chapa / matrícula', ''],
  ['transporterName', 'Nombre del transportista', ''],
  ['transporterRuc', 'RUC transportista (sin DV)', ''],
  ['transporterDv', 'DV transportista', ''],
  ['transporterAddress', 'Domicilio fiscal transportista', ''],
  ['driverName', 'Nombre del chofer', ''],
  ['driverDoc', 'Cédula del chofer', ''],
  ['driverAddress', 'Domicilio del chofer', '']
];
const downloadJson = (value, name) => {
  const objectUrl = URL.createObjectURL(new Blob([value], {type: 'application/json;charset=utf-8'}));
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
};

export default function Remision() {
  const [invoices, setInvoices] = useState([]);
  const [included, setIncluded] = useState([]);
  const [primary, setPrimary] = useState('');
  const [quantities, setQuantities] = useState({});
  const [form, setForm] = useState(defaultForm);
  const [paste, setPaste] = useState('');
  const [output, setOutput] = useState('');
  const [message, setMessage] = useState('Cargue una o varias facturas electrónicas (XML/TXT).');
  const [loading, setLoading] = useState(false);
  const chosen = useMemo(() => invoices.filter(item => included.includes(item.cdc)), [invoices, included]);
  const previewLines = useMemo(
    () => chosen.flatMap(invoice => invoice.items.map(item => ({...item, source: invoice}))),
    [chosen]
  );

  const update = (key, value) => {
    setOutput('');
    setForm(previous => ({...previous, [key]: value}));
  };
  const replaceInvoices = (newInvoices, append) => {
    const next = append ? [...invoices] : [];
    const existing = new Set(next.map(invoice => invoice.cdc));
    for (const invoice of newInvoices) {
      if (existing.has(invoice.cdc)) throw Error('CDC repetido: ' + invoice.cdc);
      next.push(invoice);
      existing.add(invoice.cdc);
    }
    if (next.length > 99) throw Error('Se admiten hasta 99 facturas.');
    const nextPrimary = append && primary ? primary : next[0]?.cdc || '';
    const main = next.find(invoice => invoice.cdc === nextPrimary);
    setInvoices(next);
    setIncluded(next.map(invoice => invoice.cdc));
    setPrimary(nextPrimary);
    setQuantities({});
    setOutput('');
    if (main) {
      setForm(previous => ({
        ...previous, ...originDefaults(main),
        establishment: previous.establishment || '001',
        point: previous.point || '001'
      }));
    }
    setMessage(next.length + ' factura(s) cargada(s). Elija la principal y revise los productos.');
  };
  const upload = async files => {
    const list = Array.from(files || []).filter(file => /\.(xml|txt)$/i.test(file.name));
    if (!list.length) return setMessage('Seleccione archivos XML o TXT.');
    setLoading(true);
    try {
      const parsed = await Promise.all(list.map(async file => parseFacturaXml(await file.text(), file.name)));
      replaceInvoices(parsed, true);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  };
  const addPasted = () => {
    try {
      replaceInvoices([parseFacturaXml(paste, 'Factura pegada')], true);
      setPaste('');
    } catch (error) {
      setMessage(error.message);
    }
  };
  const changePrimary = cdc => {
    const invoice = invoices.find(item => item.cdc === cdc);
    if (!invoice) return;
    setPrimary(cdc);
    setIncluded(old => old.includes(cdc) ? old : [...old, cdc]);
    setForm(previous => ({...previous, ...originDefaults(invoice)}));
    setOutput('');
  };
  const toggleInvoice = (cdc, checked) => {
    const next = checked ? [...included.filter(id => id !== cdc), cdc] : included.filter(id => id !== cdc);
    setIncluded(next);
    if (!next.includes(primary)) {
      const nextMain = invoices.find(invoice => next.includes(invoice.cdc));
      setPrimary(nextMain?.cdc || '');
      if (nextMain) setForm(previous => ({...previous, ...originDefaults(nextMain)}));
    }
    setOutput('');
  };
  const generate = () => {
    try {
      validateRemisionSources(chosen, primary);
      const json = buildRemision(chosen, primary, quantities, form);
      setOutput(JSON.stringify(json, null, 2));
      setMessage('Borrador NR generado: ' + json.Detalles.length +
        ' ítems de ' + json.DocumentosAsociados.length + ' factura(s). Revise el JSON y la integración.');
    } catch (error) {
      setOutput('');
      setMessage(error.message);
    }
  };

  return (
    <section className="nr-layout">
      <div className="card nr-sources">
        <h2>01 · Facturas XML de origen</h2>
        <p className="hint">Puede cargar varios archivos. Todos deben pertenecer al mismo emisor y receptor.</p>
        <label className="nr-upload">
          Cargar facturas XML / TXT
          <input type="file" accept=".xml,.txt" multiple onChange={event => {
            upload(event.target.files);
            event.target.value = '';
          }}/>
        </label>
        <label className="nr-upload">
          O agregar una carpeta
          <input type="file" multiple webkitdirectory="" directory="" onChange={event => {
            upload(event.target.files);
            event.target.value = '';
          }}/>
        </label>
        <label>
          Pegar el XML de otra factura
          <textarea rows={3} value={paste} onChange={event => setPaste(event.target.value)}
            placeholder="Pegue aquí el XML SIFEN con su CDC..."/>
        </label>
        <button disabled={!paste.trim()} onClick={addPasted}>Agregar XML pegado</button>
        <button className="secondary" onClick={() => {
          setInvoices([]); setIncluded([]); setPrimary(''); setQuantities({});
          setForm(defaultForm()); setOutput(''); setMessage('Lista de facturas limpiada.');
        }}>Limpiar todas</button>
        <div className="nr-invoices">
          {invoices.map(invoice => (
            <div className="nr-invoice" key={invoice.cdc}>
              <label title="Incluir los productos y el CDC de esta factura">
                <input type="checkbox" checked={included.includes(invoice.cdc)}
                  onChange={event => toggleInvoice(invoice.cdc, event.target.checked)}/>
                Incluir
              </label>
              <label title="Usar datos generales y receptor de esta factura">
                <input type="radio" name="nr-primary" checked={primary === invoice.cdc}
                  onChange={() => changePrimary(invoice.cdc)}/>
                Principal
              </label>
              <div className="nr-invoice-details">
                <strong>{invoice.number || invoice.filename}</strong>
                <small>{invoice.filename} · {invoice.items.length} producto(s)</small>
                <small>CDC: {invoice.cdc}</small>
                <small>Receptor: {invoice.receptor.dNomRec || 'Sin nombre'}</small>
              </div>
            </div>
          ))}
        </div>
        <p className="hint">Factura principal: sus datos se reutilizan como encabezado. Las demás solo aportan productos, conservando cada CDC asociado.</p>
      </div>

      <div className="card nr-configuration">
        <h2>02 · Datos de la nueva remisión</h2>
        <div className="nr-grid">
          {fields.map(([key, label, placeholder]) => (
            <label key={key}>{label}
              <input type={key.endsWith('Date') ? 'date' : key === 'issueTime' ? 'time' : 'text'}
                step={key === 'issueTime' ? 1 : undefined} placeholder={placeholder}
                value={form[key]} onChange={event => update(key, event.target.value)}/>
            </label>
          ))}
          <label>Motivo de traslado
            <select value={form.motivo} onChange={event => update('motivo', event.target.value)}>
              {Object.entries(MOTIVOS_REMISION).map(([code, label]) => (
                <option key={code} value={code}>{code} · {label}</option>
              ))}
            </select>
          </label>
          {form.motivo === '99' && <label>Describir otro motivo
            <input value={form.otherReason} onChange={event => update('otherReason', event.target.value)}/>
          </label>}
          <label>Transporte
            <select value={form.carrierType} onChange={event => update('carrierType', event.target.value)}>
              <option value="1">Propio</option><option value="2">Terceros</option>
            </select>
          </label>
          <label>Responsable del flete
            <select value={form.freightResponsible} onChange={event => update('freightResponsible', event.target.value)}>
              <option value="1">Emisor</option><option value="2">Receptor</option>
              <option value="3">Tercero</option><option value="4">Intermediario</option>
              <option value="5">Transporte propio</option>
            </select>
          </label>
        </div>
        {locations.map(([prefix, title]) => (
          <div key={prefix}>
            <h3>{title}</h3>
            <div className="nr-grid">
              {locationFields.map(([suffix, label]) => {
                const key = prefix + suffix;
                return (
                  <label key={key}>{label}
                    <input value={form[key]} onChange={event => update(key, event.target.value)}/>
                  </label>
                );
              })}
            </div>
          </div>
        ))}
        <h3>Vehículo, transportista y chofer</h3>
        <div className="nr-grid">
          {moreFields.map(([key, label, placeholder]) => (
            <label key={key}>{label}
              <input placeholder={placeholder} value={form[key]}
                onChange={event => update(key, event.target.value)}/>
            </label>
          ))}
        </div>
      </div>

      <div className="card nr-products">
        <h2>03 · Productos a trasladar</h2>
        <p className="hint">Cantidad 0 excluye una línea. No se mezclan productos de facturas distintas ni se agregan precios/IVA.</p>
        <div className="nr-table-wrap">
          <table className="nr-table">
            <thead><tr><th>Factura</th><th>Código</th><th>Descripción</th><th>Unidad</th><th>Original</th><th>A remitir</th></tr></thead>
            <tbody>
              {previewLines.map(item => (
                <tr key={item.rowId}>
                  <td>{item.source.number || item.source.cdc.slice(-10)}</td>
                  <td>{item.dCodInt}</td>
                  <td>{item.dDesProSer}</td>
                  <td>{item.cUniMed}</td>
                  <td>{item.dCantProSer}</td>
                  <td><input aria-label={'Cantidad para ' + item.dCodInt} value={quantities[item.rowId] ?? item.dCantProSer}
                    onChange={event => {
                      const value = event.target.value;
                      setQuantities(previous => ({...previous, [item.rowId]: value}));
                      setOutput('');
                    }}/></td>
                </tr>
              ))}
              {!previewLines.length && <tr><td colSpan={6}>Seleccione facturas para ver sus productos.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card nr-output">
        <h2>04 · JSON borrador de la NR</h2>
        <p className="hint">Se utiliza iTiDE=7, el grupo de remisión, transporte, mercaderías y un documento asociado por cada CDC. No se modifica ninguna factura.</p>
        <button className="primary" disabled={loading || !chosen.length}
          onClick={generate}>{loading ? 'Leyendo archivos…' : 'Generar borrador de remisión'}</button>
        <div className="nr-actions">
          <button disabled={!output} onClick={() => downloadJson(output, 'NR_' + (form.number || 'borrador') + '.json')}>Descargar JSON</button>
          <button disabled={!output} onClick={async () => {
            try {await navigator.clipboard.writeText(output); setMessage('JSON copiado.');}
            catch {setMessage('No se pudo copiar el JSON.');}
          }}>Copiar JSON</button>
        </div>
        <p className="nr-message" role="status">{message}</p>
        <textarea className="nr-json" readOnly value={output} rows={18}
          placeholder="El JSON se generará aquí al completar los datos de la remisión."/>
        <small>Importante: esta vista prepara un borrador basado en campos SIFEN. Antes de emitir en producción es necesario adaptar y validar el JSON contra el contrato de su API, generar el CDC, firmar, enviar a SIFEN y comprobar la aprobación.</small>
      </div>
    </section>
  );
}
