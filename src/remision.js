/**
 * Facturas FE (XML SIFEN) -> borrador de Nota de Remisión Electrónica (NRE).
 * Este módulo no firma, no genera CDC, no transmite a SIFEN y no almacena XML.
 * El JSON es un modelo de datos SIFEN; adaptar al contrato de la API emisora.
 */
const get = (node, path) => {
  let cursor = node;
  for (const part of path.split('/')) {
    cursor = Array.from(cursor?.children || []).find(child => child.localName === part);
    if (!cursor) return '';
  }
  return (cursor.textContent || '').trim();
};
const all = (node, name) => Array.from(node.getElementsByTagName('*')).filter(el => el.localName === name);
const copyFields = (node, prefix, fields) => Object.fromEntries(
  fields.map(field => [field, get(node, prefix + '/' + field)]).filter(([, value]) => value !== '')
);
const required = (value, label) => {
  const result = String(value ?? '').trim();
  if (!result) throw Error('Complete ' + label + '.');
  return result;
};
const digits = (value, size, label) => {
  const result = required(value, label);
  if (!new RegExp('^[0-9]{' + size + '}$').test(result)) {
    throw Error(label + ' debe tener ' + size + ' dígitos.');
  }
  return result;
};
const dateOnly = (value, label) => {
  const result = required(value, label);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) throw Error('Fecha inválida: ' + label);
  const parsed = new Date(result + 'T12:00:00Z');
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== result) {
    throw Error('Fecha inexistente: ' + label);
  }
  return result;
};
const scaled = (value, label) => {
  const text = required(value, label);
  if (!/^\d{1,10}(?:\.\d{1,8})?$/.test(text)) {
    throw Error(label + ': use un número positivo con hasta 8 decimales.');
  }
  const [whole, fraction = ''] = text.split('.');
  const amount = BigInt(whole) * 100000000n + BigInt(fraction.padEnd(8, '0'));
  if (amount <= 0n) throw Error(label + ' debe ser mayor que cero.');
  return amount;
};
const receptorFields = [
  'iNatRec', 'iTiOpe', 'cPaisRec', 'iTiContRec', 'dRucRec', 'dDVRec',
  'iTipIDRec', 'dDTipIDRec', 'dNumIDRec', 'dNomRec', 'dDirRec',
  'dNumCasRec', 'cDepRec', 'dDesDepRec', 'cDisRec', 'dDesDisRec',
  'cCiuRec', 'dDesCiuRec', 'dTelRec', 'dCelRec', 'dEmailRec', 'dCodCliente'
];
const issuerFields = [
  'dRucEm', 'dDVEmi', 'dNomEmi', 'dDirEmi', 'dNumCas',
  'cDepEmi', 'cDisEmi', 'cCiuEmi'
];
export const MOTIVOS_REMISION = {
  '1': 'Traslado por ventas',
  '2': 'Traslado por consignación',
  '3': 'Exportación',
  '4': 'Traslado por compra',
  '5': 'Importación',
  '6': 'Traslado por devolución',
  '7': 'Traslado entre locales de la empresa',
  '8': 'Traslado de bienes por transformación',
  '9': 'Traslado de bienes por reparación',
  '10': 'Traslado por emisor móvil',
  '11': 'Exhibición o demostración',
  '12': 'Participación en ferias',
  '13': 'Traslado de encomienda',
  '14': 'Decomiso',
  '99': 'Otro'
};

export function parseFacturaXml(source, filename = 'Factura XML') {
  let xml = String(source || '').trim().replace(/^\uFEFF/, '').trim();
  if (!xml || /<!DOCTYPE|<!ENTITY/i.test(xml)) {
    throw Error(filename + ': XML vacío o con entidades no admitidas.');
  }
  xml = xml.replace(/^<\?xml\s+.*?\?>/s, '');
  const doc = new DOMParser().parseFromString('<root>' + xml + '</root>', 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw Error(filename + ': XML inválido.');
  const documents = all(doc, 'DE');
  if (documents.length !== 1) throw Error(filename + ': debe contener una única factura DE.');
  const de = documents[0];
  if (get(de, 'gTimb/iTiDE') !== '1') {
    throw Error(filename + ': no es factura electrónica (iTiDE=1).');
  }
  const cdc = de.getAttribute('Id') || '';
  if (!/^01[0-9]{42}$/.test(cdc)) {
    throw Error(filename + ': el CDC debe tener 44 dígitos e iniciar con 01.');
  }
  const issuer = copyFields(de, 'gDatGralOpe/gEmis', issuerFields);
  const receptor = copyFields(de, 'gDatGralOpe/gDatRec', receptorFields);
  const items = all(de, 'gCamItem').map((item, index) => {
    const line = copyFields(item, '', ['dCodInt', 'dDesProSer', 'cUniMed', 'dDesUniMed']);
    // copyFields construye "/dCodInt" cuando prefix=""; leer directamente.
    for (const field of ['dCodInt', 'dDesProSer', 'cUniMed', 'dDesUniMed']) {
      const value = get(item, field);
      if (value) line[field] = value;
    }
    line.dCantProSer = get(item, 'dCantProSer');
    required(line.dCodInt, filename + ' producto ' + (index + 1) + ' código');
    required(line.dDesProSer, filename + ' producto ' + (index + 1) + ' descripción');
    required(line.cUniMed, filename + ' producto ' + (index + 1) + ' unidad');
    scaled(line.dCantProSer, filename + ' producto ' + (index + 1) + ' cantidad');
    return { ...line, rowId: cdc + ':' + index };
  });
  if (!items.length) throw Error(filename + ': no contiene productos.');
  return {
    filename, cdc, issuer, receptor, items,
    number: [get(de, 'gTimb/dEst'), get(de, 'gTimb/dPunExp'), get(de, 'gTimb/dNumDoc')].filter(Boolean).join('-'),
    issueDate: get(de, 'gDatGralOpe/dFeEmiDE')
  };
}

const identityOf = invoice => {
  const r = invoice.receptor;
  if (r.dRucRec) return 'RUC:' + r.dRucRec + '-' + (r.dDVRec || '');
  if (r.dNumIDRec) return 'DOC:' + (r.iTipIDRec || '') + ':' + r.dNumIDRec;
  return '';
};
export function validateRemisionSources(invoices, principalCdc) {
  if (!Array.isArray(invoices) || !invoices.length) throw Error('Seleccione al menos una factura.');
  if (invoices.length > 99) throw Error('No se admiten más de 99 facturas asociadas.');
  const principal = invoices.find(item => item.cdc === principalCdc);
  if (!principal) throw Error('Seleccione una factura principal incluida en la remisión.');
  const emitter = required(principal.issuer.dRucEm, 'el RUC del emisor en la factura principal');
  const identity = required(identityOf(principal), 'la identificación del receptor en la factura principal');
  const seen = new Set();
  for (const invoice of invoices) {
    if (seen.has(invoice.cdc)) throw Error('Factura duplicada: ' + invoice.cdc);
    seen.add(invoice.cdc);
    if (!invoice.issuer.dRucEm || invoice.issuer.dRucEm !== emitter) {
      throw Error('Las facturas deben tener el mismo RUC emisor; revisar ' + invoice.filename);
    }
    if (identityOf(invoice) !== identity) {
      throw Error('Las facturas deben corresponder al mismo receptor; revisar ' + invoice.filename);
    }
  }
  return principal;
}

const transportLocation = (values, suffix) => {
  const prefix = suffix === 'Sal' ? 'sal' : 'ent';
  return {
    ['dDirLoc' + suffix]: required(values[prefix + 'Address'], 'dirección de ' + prefix),
    ['dNumCas' + suffix]: required(values[prefix + 'House'], 'número de casa de ' + prefix),
    ['cDep' + suffix]: required(values[prefix + 'Department'], 'departamento de ' + prefix),
    ['cDis' + suffix]: required(values[prefix + 'District'], 'distrito de ' + prefix),
    ['cCiu' + suffix]: required(values[prefix + 'City'], 'ciudad de ' + prefix)
  };
};

export function buildRemision(invoices, principalCdc, quantities, form) {
  const principal = validateRemisionSources(invoices, principalCdc);
  const motivo = required(form.motivo, 'el motivo de traslado');
  if (!MOTIVOS_REMISION[motivo]) throw Error('Motivo de traslado desconocido.');
  if (motivo === '7' && principal.issuer.dRucEm !== principal.receptor.dRucRec) {
    throw Error('Entre locales, el receptor debe tener el mismo RUC que el emisor.');
  }
  const departure = dateOnly(form.startDate, 'inicio del traslado');
  const arrival = dateOnly(form.endDate, 'fin del traslado');
  if (arrival < departure) throw Error('La fecha de fin no puede ser anterior al inicio.');
  const date = dateOnly(form.issueDate, 'fecha de emisión');
  const km = required(form.km, 'kilómetros estimados');
  if (!/^[0-9]{1,5}$/.test(km) || Number(km) < 1) {
    throw Error('Kilómetros: ingrese un valor entre 1 y 99999.');
  }
  const details = [];
  for (const inv of invoices) {
    for (const item of inv.items) {
      const quantity = quantities[item.rowId] === undefined ? item.dCantProSer : String(quantities[item.rowId]).trim();
      if (quantity === '0' || quantity === '0.0' || quantity === '') continue; // omitido manualmente
      if (scaled(quantity, 'cantidad para ' + item.dCodInt) > scaled(item.dCantProSer, 'cantidad original')) {
        throw Error('La cantidad trasladada supera la factura para ' + item.dCodInt + ' (' + inv.filename + ').');
      }
      const { dCodInt, dDesProSer, cUniMed, dDesUniMed } = item;
      details.push({ dCodInt, dDesProSer, cUniMed, ...(dDesUniMed ? { dDesUniMed } : {}), dCantProSer: quantity });
    }
  }
  if (!details.length) throw Error('Debe incluir al menos un producto.');
  if (details.length > 999) throw Error('La remisión admite hasta 999 ítems.');
  const carrierType = required(form.carrierType, 'tipo de transporte');
  if (!['1', '2'].includes(carrierType)) throw Error('Tipo de transporte no admitido.');
  const transporter = {
    iNatTrans: '1',
    dNomTrans: required(form.transporterName, 'nombre del transportista'),
    dRucTrans: required(form.transporterRuc, 'RUC del transportista'),
    dDVTrans: required(form.transporterDv, 'DV del transportista'),
    cNacTrans: 'PRY',
    dNumIDChof: required(form.driverDoc, 'documento del chofer'),
    dNomChof: required(form.driverName, 'nombre del chofer'),
    dDomFisc: required(form.transporterAddress, 'domicilio fiscal del transportista'),
    dDirChof: required(form.driverAddress, 'dirección del chofer')
  };
  if (!/^\d{3,8}$/.test(transporter.dRucTrans) || !/^\d$/.test(transporter.dDVTrans)) {
    throw Error('Revise el RUC y dígito verificador del transportista.');
  }
  const gCamNRE = {
    iMotEmiNR: motivo,
    dDesMotEmiNR: motivo === '99' ? required(form.otherReason, 'otro motivo') : MOTIVOS_REMISION[motivo],
    iRespEmiNR: '1',
    dDesRespEmiNR: 'Emisor de la factura',
    dKmR: km
  };
  const gTransp = {
    iTipTrans: carrierType,
    dDesTipTrans: carrierType === '1' ? 'Propio' : 'Tercero',
    iModTrans: '1',
    dDesModTrans: 'Terrestre',
    iRespFlete: required(form.freightResponsible, 'responsable del flete'),
    dIniTras: departure,
    dFinTras: arrival,
    cPaisDest: 'PRY',
    dDesPaisDest: 'Paraguay',
    gCamSal: transportLocation(form, 'Sal'),
    gCamEnt: transportLocation(form, 'Ent'),
    gVehTras: {
      dTiVehTras: required(form.vehicleType, 'tipo de vehículo'),
      dMarVeh: required(form.vehicleBrand, 'marca del vehículo'),
      dTipIdenVeh: '2',
      dNroMatVeh: required(form.plate, 'chapa del vehículo')
    },
    gCamTrans: transporter
  };
  return {
    iTiDE: '7',
    dEst: digits(form.establishment, 3, 'establecimiento'),
    dPunExp: digits(form.point, 3, 'punto de expedición'),
    dNumDoc: digits(form.number, 7, 'número de remisión'),
    dFeEmiDE: date + 'T' + required(form.issueTime, 'hora de emisión'),
    ...principal.receptor,
    gCamNRE,
    Detalles: details,
    gTransp,
    DocumentosAsociados: invoices.map(inv => ({ iTipDocAso: '1', dCdCDERef: inv.cdc }))
  };
}
