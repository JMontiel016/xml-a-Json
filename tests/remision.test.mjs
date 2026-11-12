import test from 'node:test';
import assert from 'node:assert/strict';
import {buildRemision, validateRemisionSources} from '../src/remision.js';

const issuer = {dRucEm: '80012345', dDVEmi: '6'};
const receptor = {dRucRec: '1234567', dDVRec: '8', dNomRec: 'Cliente', dDirRec: 'Ruta', iNatRec: '1'};
const invoice = n => ({
  cdc: '01' + String(n).repeat(42),
  filename: 'factura-' + n + '.xml',
  issuer, receptor,
  items: [{rowId: 'fila-' + n, dCodInt: 'COD-' + n, dDesProSer: 'Producto ' + n,
    cUniMed: '77', dCantProSer: String(n)}]
});
const form = {
  motivo: '1', establishment: '001', point: '002', number: '0000123',
  issueDate: '2026-11-12', issueTime: '11:00:00',
  startDate: '2026-11-13', endDate: '2026-11-13', km: '20',
  carrierType: '1', freightResponsible: '1',
  salAddress: 'Origen', salHouse: '0', salDepartment: '1', salDistrict: '1', salCity: '1',
  entAddress: 'Destino', entHouse: '0', entDepartment: '1', entDistrict: '1', entCity: '1',
  vehicleType: 'Camion', vehicleBrand: 'Marca', plate: 'AA123',
  transporterName: 'Emisor', transporterRuc: '80012345', transporterDv: '6',
  transporterAddress: 'Calle 1', driverName: 'Chofer', driverDoc: '3333333',
  driverAddress: 'Calle 2'
};
test('consolida los productos manteniendo el CDC de cada factura', () => {
  const docs = [invoice(1), invoice(2), invoice(3)];
  const result = buildRemision(docs, docs[1].cdc, {'fila-2': '1', 'fila-3': '0'}, form);
  assert.equal(result.iTiDE, '7');
  assert.equal(result.DocumentosAsociados.length, 3);
  assert.equal(result.Detalles.length, 2);
  assert.deepEqual(result.Detalles.map(i => i.dCantProSer), ['1', '1']);
  assert.ok(result.Detalles.every(i => !('dPUniProSer' in i) && !('iAfecIVA' in i)));
  assert.ok(result.gTransp.gCamSal && result.gTransp.gCamEnt);
});
test('rechaza facturas duplicadas', () => {
  const doc = invoice(1);
  assert.throws(() => validateRemisionSources([doc, doc], doc.cdc), /duplicada/i);
});
test('rechaza mezcla de receptores o emisores', () => {
  const first = invoice(1);
  assert.throws(() => validateRemisionSources(
    [first, {...invoice(2), receptor: {...receptor, dRucRec: '8888888'}}], first.cdc
  ), /receptor/i);
  assert.throws(() => validateRemisionSources(
    [first, {...invoice(2), issuer: {...issuer, dRucEm: '99999'}}], first.cdc
  ), /emisor/i);
});
test('rechaza cantidad superior a la disponible en la factura', () => {
  const doc = invoice(1);
  assert.throws(() => buildRemision([doc], doc.cdc, {'fila-1': '2'}, form), /supera/i);
});
