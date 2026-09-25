"""Conversión de factura SIFEN a NC. Importes con Decimal, sin float."""
import json
import re
from decimal import Decimal, InvalidOperation, ROUND_DOWN, ROUND_HALF_UP
from xml.etree import ElementTree as ET

EIGHT = Decimal('0.00000001')
FOUR = Decimal('0.0001')
ZERO = Decimal(0)

def money(value):
    return '' if value is None else format(value.quantize(EIGHT), '.8f')

def dec(value, field):
    if value is None or value == '':
        return None
    if not re.fullmatch(r'[0-9]+(?:\.[0-9]+)?', str(value)):
        raise ValueError(f'Importe inválido en {field}: {value}')
    return Decimal(value)

def required(value, field):
    result = dec(value, field)
    if result is None:
        raise ValueError(f'Falta {field} en el XML; no se puede modificar ese importe.')
    return result

def positive(value, field):
    result = required(value, field)
    if result <= 0:
        raise ValueError(f'El {field} debe ser mayor que cero.')
    if result != result.quantize(EIGHT):
        raise ValueError(f'El {field} admite hasta 8 decimales.')
    return result

def child(node, name):
    if node is None:
        return None
    for element in node:
        if element.tag.split('}')[-1] == name:
            return element
    return None

def value(node, path):
    for segment in path.split('/'):
        node = child(node, segment)
        if node is None:
            return ''
    return ''.join(node.itertext()).strip()

def all_nodes(root, name):
    return [n for n in root.iter() if n.tag.split('}')[-1] == name]

def add(sub, key, amount):
    before = dec(sub[key], key)
    sub[key] = money(before + amount) if before is not None and amount is not None else ''

def combine(sub, dest, a, b):
    x, y = dec(sub[a], a), dec(sub[b], b)
    sub[dest] = money(x + y) if x is not None and y is not None else ''

def totals_for(items):
    keys = ['dSubExe','dSubExo','dSub5','dSub10','dTotOpe','dTotGralOpe','dIVA5','dIVA10','dTotIVA','dBaseGrav5','dBaseGrav10','dTBasGraIVA']
    sub = {key: money(ZERO) for key in keys}
    sub['dTotalGs'] = ''
    for item in items:
        total = dec(item['dTotOpeItem'], 'dTotOpeItem')
        gross = dec(item['dTotBruOpeItem'], 'dTotBruOpeItem')
        quantity = dec(item['dCantProSer'], 'dCantProSer')
        dec(item['dPUniProSer'], 'dPUniProSer')
        base = dec(item['dBasGravIVA'], 'dBasGravIVA')
        tax = dec(item['dLiqIVAItem'], 'dLiqIVAItem')
        exempt = dec(item['dBaseExe'], 'dBaseExe')
        if quantity is not None and quantity <= 0:
            raise ValueError('La cantidad debe ser mayor que cero.')
        if gross is not None and total is not None and gross != total:
            raise ValueError(f"El producto {item['dCodInt']} tiene descuentos o anticipos. La plantilla reducida no incluye esos campos.")
        add(sub, 'dTotOpe', total)
        affect, rate = item['iAfecIVA'], item['dTasaIVA']
        if affect in ('2', '3'):
            add(sub, 'dSubExo' if affect == '2' else 'dSubExe', total)
            if (base is not None and base != 0) or (tax is not None and tax != 0):
                raise ValueError('El ítem exento/exonerado contiene IVA distinto de cero.')
        elif affect in ('1', '4'):
            numeric_rate = dec(rate, 'dTasaIVA')
            if numeric_rate is None:
                if affect == '4':
                    add(sub, 'dSubExe', exempt)
                for key in ('dSub5','dSub10','dIVA5','dIVA10','dBaseGrav5','dBaseGrav10'):
                    sub[key] = ''
            else:
                if numeric_rate not in (Decimal(5), Decimal(10)):
                    raise ValueError(f'Tasa IVA no compatible: {rate}')
                suffix = str(int(numeric_rate))
                taxable = total
                if affect == '4':
                    add(sub, 'dSubExe', exempt)
                    taxable = total - exempt if total is not None and exempt is not None else None
                    if taxable is not None and taxable < 0:
                        raise ValueError('La base exenta supera el total del producto.')
                add(sub, 'dSub' + suffix, taxable)
                add(sub, 'dIVA' + suffix, tax)
                add(sub, 'dBaseGrav' + suffix, base)
        elif affect == '':
            for key in ('dSubExe','dSubExo','dSub5','dSub10','dIVA5','dIVA10','dBaseGrav5','dBaseGrav10'):
                sub[key] = ''
        else:
            raise ValueError(f'Afectación IVA no compatible: {affect}')
    sub['dTotGralOpe'] = sub['dTotOpe']
    combine(sub, 'dTotIVA', 'dIVA5', 'dIVA10')
    combine(sub, 'dTBasGraIVA', 'dBaseGrav5', 'dBaseGrav10')
    return sub

def tax_for(item):
    total = dec(item['dTotOpeItem'], 'dTotOpeItem')
    affect = item['iAfecIVA']
    if total is None or not affect or (affect in ('1','4') and (not item['dTasaIVA'] or not item['dPropIVA'])):
        item.update(dBasGravIVA='', dLiqIVAItem='', dBaseExe='')
        return
    if affect in ('2', '3'):
        item.update(dBasGravIVA=money(ZERO), dLiqIVAItem=money(ZERO), dBaseExe=money(ZERO))
        return
    if affect not in ('1', '4'):
        raise ValueError('Falta una afectación IVA válida para recalcular el producto.')
    rate = required(item['dTasaIVA'], 'tasa IVA')
    proportion = required(item['dPropIVA'], 'proporción IVA')
    if rate not in (Decimal(5), Decimal(10)) or not (ZERO < proportion <= 100) or (affect == '1' and proportion != 100):
        raise ValueError('Tasa o proporción IVA incompatible con la afectación.')
    denominator = Decimal(10000) + rate * proportion
    base = (total * 100 * proportion / denominator).quantize(EIGHT, rounding=ROUND_HALF_UP)
    tax = total - base if affect == '1' else (total * proportion * rate / denominator).quantize(EIGHT, rounding=ROUND_HALF_UP)
    exempt = total - base - tax if affect == '4' else ZERO
    if exempt < 0:
        raise ValueError('El redondeo produce una base exenta negativa.')
    item.update(dBasGravIVA=money(base), dLiqIVAItem=money(tax), dBaseExe=money(exempt))

def partial_items(original, opts):
    if not opts['single']:
        return original
    codes = []
    if not opts['code']:
        selected = [dict(i) for i in original]
    else:
        selected = []
        for token in opts['code'].split(';'):
            code = token.strip()
            if not code or code in codes:
                raise ValueError('Hay un código vacío o repetido en la selección.')
            found = [dict(i) for i in original if i['dCodInt'] == code]
            if not found:
                raise ValueError(f'No se encontró el código {code}.')
            selected.extend(found)
            codes.append(code)
    if not opts['quantity'] and not opts['amount']:
        return selected
    totals_for(selected)
    quantities = opts['quantity'].split(';') if opts['quantity'] else None
    if quantities is not None and len(quantities) not in (len(selected), len(codes)):
        raise ValueError(f'Informá una cantidad por código o por línea seleccionada ({len(selected)} líneas encontradas).')
    requested, limits = [], []
    for index, item in enumerate(selected):
        old_quantity = required(item['dCantProSer'], 'cantidad')
        price = required(item['dPUniProSer'], 'precio')
        old_total = required(item['dTotOpeItem'], 'total')
        qstr = ''
        if quantities is not None:
            qstr = quantities[index].strip() if len(quantities) == len(selected) else quantities[codes.index(item['dCodInt'])].strip()
        quantity = positive(qstr, 'cantidad') if qstr else old_quantity
        if quantity <= 0 or quantity > old_quantity:
            raise ValueError(f"La cantidad de {item['dCodInt']} (línea {index + 1}) debe ser mayor que cero y no superar la original.")
        if quantity != quantity.quantize(FOUR):
            raise ValueError('La cantidad admite hasta 4 decimales.')
        limit = old_total if quantity == old_quantity else (price * quantity).quantize(EIGHT, rounding=ROUND_HALF_UP)
        if limit > old_total:
            raise ValueError('El importe supera el original del producto.')
        requested.append(quantity)
        limits.append(limit)
    available = sum(limits, ZERO)
    by_amount = bool(opts['amount'])
    asked = positive(opts['amount'], 'monto total') if by_amount else available
    if asked > available:
        raise ValueError(f'El monto supera el disponible para los productos y cantidades: {available}')
    cumulative_weight = allocated = ZERO
    result = []
    for index, item in enumerate(selected):
        total = limits[index]
        if by_amount:
            cumulative_weight += limits[index]
            cumulative = (asked * cumulative_weight / available).quantize(EIGHT, rounding=ROUND_DOWN)
            total = cumulative - allocated
            allocated = cumulative
            if total == 0:
                continue
        quantity = requested[index]
        old_quantity = required(item['dCantProSer'], 'cantidad')
        old_total = required(item['dTotOpeItem'], 'total')
        if quantity != old_quantity or total != old_total:
            price = (total / quantity).quantize(EIGHT, rounding=ROUND_HALF_UP) if by_amount else required(item['dPUniProSer'], 'precio')
            if (quantity * price).quantize(EIGHT, rounding=ROUND_HALF_UP) != total and (total / quantity).quantize(EIGHT, rounding=ROUND_HALF_UP) != price:
                raise ValueError(f"El monto de {item['dCodInt']} no coincide con cantidad × precio a 8 decimales. Ajustá monto o cantidad.")
            item.update(dCantProSer=format(quantity.quantize(FOUR), '.4f'), dPUniProSer=money(price), dTotBruOpeItem=money(total), dTotOpeItem=money(total))
            tax_for(item)
        result.append(item)
    if not result:
        raise ValueError('El monto no permite generar ninguna línea.')
    totals_for(result)
    return result

def currency_for(header, items, totals):
    currency = header['cMoneOpe']
    if not currency or currency == 'PYG':
        return
    condition = header.get('dCondTiCam', '')
    if condition == '1':
        rate = dec(header.get('dTiCam', ''), 'dTiCam')
        if rate is None:
            return
        if rate <= 0:
            raise ValueError('La cotización debe ser mayor que cero.')
        total = dec(totals['dTotGralOpe'], 'dTotGralOpe')
        if total is not None:
            totals['dTotalGs'] = money((total * rate).quantize(EIGHT, rounding=ROUND_HALF_UP))
    elif condition == '2':
        converted = ZERO
        missing = False
        for item in items:
            rate = dec(item.get('dTiCamIt',''), 'dTiCamIt')
            total = dec(item['dTotOpeItem'], 'dTotOpeItem')
            if rate is not None and rate <= 0:
                raise ValueError('La cotización por ítem debe ser mayor que cero.')
            if rate is None or total is None:
                item['dTotOpeGs'] = ''
                missing = True
            else:
                amount = (total * rate).quantize(EIGHT, rounding=ROUND_HALF_UP)
                item['dTotOpeGs'] = money(amount)
                converted += amount
        if not missing:
            totals['dTotalGs'] = money(converted)
    elif condition:
        raise ValueError('Condición de tipo de cambio no compatible: ' + condition)

def convert(data):
    opts = {key: str(data.get(key) or '').strip() for key in ('establishment','point','number','date','reason','code','quantity','amount')}
    opts['single'] = data.get('single') is True
    if re.fullmatch(r'\d{4}-\d{2}-\d{2}', opts['date']):
        opts['date'] += 'T00:00:00'
    for key, digits, label in [('establishment',3,'Establecimiento'),('point',3,'Punto de expedición'),('number',7,'Número de NC')]:
        if opts[key] and not re.fullmatch(r'\d{' + str(digits) + r'}', opts[key]):
            raise ValueError(f'{label}: se requieren {digits} dígitos.')
    if opts['date']:
        from datetime import datetime
        if not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}', opts['date']):
            raise ValueError('Fecha NC: usá AAAA-MM-DDThh:mm:ss.')
        try:
            datetime.strptime(opts['date'], '%Y-%m-%dT%H:%M:%S')
        except ValueError:
            raise ValueError('Fecha de NC inválida.')
    if opts['reason'] and opts['reason'] not in [str(i) for i in range(1,9)]:
        raise ValueError('iMotEmi debe ser un código entre 1 y 8.')
    if opts['single'] and not opts['code'] and not opts['amount']:
        raise ValueError('Para una NC parcial informá códigos o un monto.')
    if opts['single'] and opts['quantity'] and not opts['code']:
        raise ValueError('Para informar cantidades indicá los códigos correspondientes.')
    xml = str(data.get('xml') or '').strip().lstrip('\ufeff').strip()
    notice = 'This XML file does not appear to have any style information associated with it. The document tree is shown below.'
    if xml.startswith(notice):
        xml = xml[len(notice):].strip()
    xml = re.sub(r'&(?!(?:amp|lt|gt|quot|apos|#[0-9]+|#x[0-9a-fA-F]+);)', '&amp;', xml)
    xml = re.sub(r'^<\?xml\s+.*?\?>', '', xml, flags=re.S)
    if not xml:
        raise ValueError('La entrada está vacía.')
    if re.search(r'<!DOCTYPE|<!ENTITY', xml, re.I):
        raise ValueError('El XML no puede contener DTD ni entidades externas.')
    try:
        root = ET.fromstring('<conversion-root>' + xml + '</conversion-root>')
    except ET.ParseError as exc:
        raise ValueError(f'XML inválido cerca de la línea {exc.position[0]}.')
    documents = all_nodes(root, 'DE')
    if len(documents) != 1:
        raise ValueError('Pegá un solo documento DE completo.')
    de = documents[0]
    if value(de, 'gTimb/iTiDE') != '1':
        raise ValueError('El XML de origen debe ser una factura electrónica (iTiDE=1).')
    cdc = de.get('Id', '')
    if cdc and not re.fullmatch(r'[0-9]{44}', cdc):
        raise ValueError('El CDC de la factura debe tener 44 dígitos.')
    header = {'iTiDE':'5','dEst':opts['establishment'],'dPunExp':opts['point'],'dNumDoc':opts['number'],'dFeEmiDE':opts['date'],'iTImp':value(de,'gDatGralOpe/gOpeCom/iTImp')}
    currency = value(de,'gDatGralOpe/gOpeCom/cMoneOpe')
    header['cMoneOpe'] = currency
    if currency and currency != 'PYG':
        header['dCondTiCam'] = value(de,'gDatGralOpe/gOpeCom/dCondTiCam')
        if header['dCondTiCam'] != '2':
            header['dTiCam'] = value(de,'gDatGralOpe/gOpeCom/dTiCam')
    for key in ('iNatRec','iTiOpe','cPaisRec','iTiContRec','dRucRec','dDVRec'):
        header[key] = value(de, 'gDatGralOpe/gDatRec/' + key)
    if header['iNatRec'] == '2':
        for key in ('iTipIDRec','dDTipIDRec','dNumIDRec'):
            header[key] = value(de,'gDatGralOpe/gDatRec/' + key)
    for key in ('dNomRec','dDirRec','dNumCasRec'):
        header[key] = value(de,'gDatGralOpe/gDatRec/' + key)
    for key in ('cDepRec','dDesDepRec','cDisRec','dDesDisRec','cCiuRec','dDesCiuRec'):
        field = value(de,'gDatGralOpe/gDatRec/' + key)
        if field:
            header[key] = field
    for key in ('dTelRec','dCelRec','dEmailRec'):
        header[key] = value(de,'gDatGralOpe/gDatRec/' + key)
    header['iMotEmi'] = opts['reason']
    items = []
    for element in all_nodes(de,'gCamItem'):
        item = {}
        for key, path in [('dCodInt','dCodInt'),('dDesProSer','dDesProSer'),('cUniMed','cUniMed'),('dCantProSer','dCantProSer'),('dPUniProSer','gValorItem/dPUniProSer'),('dTotBruOpeItem','gValorItem/dTotBruOpeItem'),('dTotOpeItem','gValorItem/gValorRestaItem/dTotOpeItem'),('iAfecIVA','gCamIVA/iAfecIVA'),('dPropIVA','gCamIVA/dPropIVA'),('dTasaIVA','gCamIVA/dTasaIVA'),('dBasGravIVA','gCamIVA/dBasGravIVA'),('dLiqIVAItem','gCamIVA/dLiqIVAItem'),('dBaseExe','gCamIVA/dBasExe')]:
            item[key] = value(element,path)
        if currency and currency != 'PYG' and header.get('dCondTiCam') == '2':
            item['dTiCamIt'] = value(element,'gValorItem/dTiCamIt')
        items.append(item)
    if not items:
        raise ValueError('El XML no contiene productos.')
    items = partial_items(items, opts)
    for key in ('dRedon','dComi','dIVAComi'):
        field = value(de,'gTotSub/' + key)
        if field and Decimal(field) != 0:
            raise ValueError(f'La factura contiene {key}. Esta plantilla reducida requiere revisar ese ajuste.')
    totals = totals_for(items)
    currency_for(header, items, totals)
    summary = f"Moneda: {currency or 'sin informar'} | Total NC: {totals['dTotGralOpe']} | IVA 5%: {totals['dIVA5']} | IVA 10%: {totals['dIVA10']}"
    if currency and currency != 'PYG':
        rate = 'por ítem' if header.get('dCondTiCam') == '2' else header.get('dTiCam','')
        summary += f" | Cambio: {rate} | Total Gs: {totals['dTotalGs'] or 'pendiente: faltan datos de cambio/importes'}"
    result = {**header,'Detalles':items,'Subtotales':[totals],'DocumentosAsociados':[{'iTipDocAso':'1','dCdCDERef':cdc}]}
    return {'json':json.dumps(result,ensure_ascii=False,indent=4),'count':len(items),'summary':summary}
