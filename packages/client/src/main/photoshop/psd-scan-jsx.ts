interface PsdScanJsxInput {
  psdPath: string
  resultFilePath: string
}

function jsonString(value: string): string {
  return JSON.stringify(value)
}

export function renderPsdScanJsx(input: PsdScanJsxInput): string {
  return `var PSD_PATH = ${jsonString(input.psdPath)};
var RESULT_FILE_PATH = ${jsonString(input.resultFilePath)};

function escapeJsonString(value) {
  return String(value)
    .replace(/\\\\/g, '\\\\\\\\')
    .replace(/"/g, '\\\\"')
    .replace(/\\r/g, '\\\\r')
    .replace(/\\n/g, '\\\\n')
    .replace(/\\t/g, '\\\\t');
}

function toJson(value) {
  if (value === null) {
    return 'null';
  }
  var type = typeof value;
  if (type === 'string') {
    return '"' + escapeJsonString(value) + '"';
  }
  if (type === 'number') {
    return isFinite(value) ? String(value) : 'null';
  }
  if (type === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (value instanceof Array) {
    var items = [];
    for (var i = 0; i < value.length; i++) {
      items.push(toJson(value[i]));
    }
    return '[' + items.join(',') + ']';
  }
  if (type === 'object') {
    var props = [];
    for (var key in value) {
      if (value.hasOwnProperty(key) && typeof value[key] !== 'undefined' && typeof value[key] !== 'function') {
        props.push('"' + escapeJsonString(key) + '":' + toJson(value[key]));
      }
    }
    return '{' + props.join(',') + '}';
  }
  return 'null';
}

function numberValue(value) {
  try {
    if (value && value.value !== undefined) {
      return Number(value.value);
    }
  } catch (e) {}
  return Number(value);
}

function layerBounds(layer) {
  try {
    return [
      numberValue(layer.bounds[0]),
      numberValue(layer.bounds[1]),
      numberValue(layer.bounds[2]),
      numberValue(layer.bounds[3])
    ];
  } catch (e) {
    return null;
  }
}

function normalizeSmartObjectName(name) {
  return String(name)
    .replace(/\\s+copy(\\s+\\d+)?$/i, '')
    .replace(/\\s+\\d+$/i, '')
    .toLowerCase();
}

function getSmartObjectId(layer) {
  var bounds = layerBounds(layer) || [0, 0, 0, 0];
  return normalizeSmartObjectName(layer.name) + '|' + bounds.join(',');
}

function pushLayerInfo(result, layer, layerPath) {
  var bounds = layerBounds(layer);
  var isGroup = layer.typename === 'LayerSet';
  var isSmartObject = layer.typename === 'ArtLayer' && layer.kind === LayerKind.SMARTOBJECT;
  var isText = layer.typename === 'ArtLayer' && layer.kind === LayerKind.TEXT;
  var info = {
    name: String(layer.name),
    path: layerPath,
    typename: String(layer.typename),
    is_group: isGroup,
    is_smart_object: isSmartObject,
    is_text: isText
  };
  if (bounds) {
    info.bounds = bounds;
  }
  result.layers.push(info);
}

function walkLayers(layers, parentPath, result) {
  for (var i = 0; i < layers.length; i++) {
    var layer = layers[i];
    var layerPath = parentPath + layer.name;
    pushLayerInfo(result, layer, layerPath);

    if (layer.typename === 'ArtLayer' && layer.kind === LayerKind.SMARTOBJECT) {
      result.smart_objects.push({
        name: String(layer.name),
        path: layerPath,
        sort_order: i,
        is_top_level: parentPath === '',
        bounds: layerBounds(layer) || [0, 0, 0, 0],
        shared_indicator: getSmartObjectId(layer)
      });
    } else if (layer.typename === 'ArtLayer' && layer.kind === LayerKind.TEXT) {
      var text = '';
      try {
        text = String(layer.textItem.contents);
      } catch (e) {}
      var textLayer = {
        name: String(layer.name),
        path: layerPath,
        text: text
      };
      var textBounds = layerBounds(layer);
      if (textBounds) {
        textLayer.bounds = textBounds;
      }
      result.text_layers.push(textLayer);
    } else if (layer.typename === 'LayerSet') {
      walkLayers(layer.layers, layerPath + '/', result);
    }
  }
}

function uniqueSortedNumbers(values, maxValue) {
  var seen = {};
  var output = [];
  for (var i = 0; i < values.length; i++) {
    var value = Math.round(Number(values[i]));
    if (value > 0 && value < maxValue && !seen[value]) {
      seen[value] = true;
      output.push(value);
    }
  }
  output.sort(function(a, b) { return a - b; });
  return output;
}

function deriveClipAreas(guides, docSize) {
  var vertical = uniqueSortedNumbers(guides.vertical, docSize.w);
  var horizontal = uniqueSortedNumbers(guides.horizontal, docSize.h);
  if (vertical.length === 0 && horizontal.length === 0) {
    return [{ x: 0, y: 0, w: docSize.w, h: docSize.h, is_full: true }];
  }

  var xs = [0].concat(vertical).concat([docSize.w]);
  var ys = [0].concat(horizontal).concat([docSize.h]);
  var areas = [];
  for (var y = 0; y < ys.length - 1; y++) {
    for (var x = 0; x < xs.length - 1; x++) {
      var width = xs[x + 1] - xs[x];
      var height = ys[y + 1] - ys[y];
      if (width > 0 && height > 0) {
        areas.push({ x: xs[x], y: ys[y], w: width, h: height, is_full: false });
      }
    }
  }
  return areas.length > 0 ? areas : [{ x: 0, y: 0, w: docSize.w, h: docSize.h, is_full: true }];
}

function nativeSliceKind(origin) {
  var value = String(origin).toLowerCase();
  if (value.indexOf('auto') >= 0) {
    return 'auto';
  }
  if (value.indexOf('layer') >= 0) {
    return 'layer';
  }
  return 'user';
}

function descriptorNumber(descriptor, key) {
  try { return descriptor.getUnitDoubleValue(key); } catch (e1) {}
  try { return descriptor.getDouble(key); } catch (e2) {}
  return descriptor.getInteger(key);
}

function scanNativeSlices() {
  var output = [];
  var slicesKey = stringIDToTypeID('slices');
  var reference = new ActionReference();
  reference.putProperty(stringIDToTypeID('property'), slicesKey);
  reference.putEnumerated(
    stringIDToTypeID('document'),
    stringIDToTypeID('ordinal'),
    stringIDToTypeID('targetEnum')
  );
  var documentDescriptor = executeActionGet(reference);
  if (!documentDescriptor.hasKey(slicesKey)) {
    throw new Error('Photoshop does not expose the document slices descriptor');
  }
  var slices = documentDescriptor.getObjectValue(slicesKey).getList(slicesKey);
  var originKey = stringIDToTypeID('origin');
  var nameKey = stringIDToTypeID('name');
  var boundsKey = stringIDToTypeID('bounds');
  var topKey = stringIDToTypeID('top');
  var leftKey = stringIDToTypeID('left');
  var bottomKey = stringIDToTypeID('bottom');
  var rightKey = stringIDToTypeID('right');
  for (var i = 0; i < slices.count; i++) {
    var slice = slices.getObjectValue(i);
    var origin = slice.hasKey(originKey)
      ? typeIDToStringID(slice.getEnumerationValue(originKey))
      : 'userGenerated';
    var bounds = slice.getObjectValue(boundsKey);
    output.push({
      name: slice.hasKey(nameKey) ? slice.getString(nameKey) : ('slice-' + (i + 1)),
      kind: nativeSliceKind(origin),
      bounds: [
        descriptorNumber(bounds, leftKey),
        descriptorNumber(bounds, topKey),
        descriptorNumber(bounds, rightKey),
        descriptorNumber(bounds, bottomKey)
      ]
    });
    }
  return output;
}

function writeResult(value) {
  var file = new File(RESULT_FILE_PATH);
  file.encoding = 'UTF8';
  file.open('w');
  file.write(toJson(value));
  file.close();
}

function scanPsd() {
  var previousRulerUnits = app.preferences.rulerUnits;
  var beforeDocCount = app.documents.length;
  var doc = null;
  var openedByScan = false;
  try {
    app.preferences.rulerUnits = Units.PIXELS;
    doc = app.open(new File(PSD_PATH));
    openedByScan = app.documents.length > beforeDocCount;

    var docSize = {
      w: numberValue(doc.width),
      h: numberValue(doc.height)
    };
    var result = {
      ok: true,
      file: PSD_PATH,
      doc_size: docSize,
      smart_objects: [],
      guides: { horizontal: [], vertical: [] },
      clip_areas: [],
      native_slices: scanNativeSlices(),
      layers: [],
      text_layers: []
    };

    walkLayers(doc.layers, '', result);

    for (var i = 0; i < doc.guides.length; i++) {
      var guide = doc.guides[i];
      if (guide.direction === Direction.HORIZONTAL) {
        result.guides.horizontal.push(numberValue(guide.coordinate));
      } else {
        result.guides.vertical.push(numberValue(guide.coordinate));
      }
    }

    writeResult(result);
  } catch (error) {
    writeResult({ ok: false, error: String(error), file: PSD_PATH });
  } finally {
    try {
      app.preferences.rulerUnits = previousRulerUnits;
    } catch (e1) {}
    try {
      if (doc && openedByScan) {
        doc.close(SaveOptions.DONOTSAVECHANGES);
      }
    } catch (e2) {}
  }
}

scanPsd();
`
}
