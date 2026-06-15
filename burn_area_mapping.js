// ============================================================
//  Burn Severity Mapping using Normalised Burn Ratio (NBR)
//  Sensors  : Sentinel-2 (10 m) | Landsat 8 (30 m)
//  Output   : dNBR classified map + per-class area statistics
//  Author   : Shahid Shuja Shafai  <shahidshafai@gmail.com>
//  Lab      : Remote Sensing and GIS Lab (RSGL), SKUAST-Kashmir
// ============================================================

// ── DESCRIPTION ─────────────────────────────────────────────
//
// Wildfire and agricultural burning leave behind distinct spectral
// signatures in the shortwave infrared and near-infrared regions of
// the electromagnetic spectrum. This app exploits that contrast through
// the Normalised Burn Ratio (NBR = (NIR − SWIR2) / (NIR + SWIR2)),
// computed independently for pre-fire and post-fire image composites.
//
// The difference (dNBR = preNBR − postNBR), scaled to USGS standards
// by multiplying by 1000, quantifies fire-induced vegetation loss:
// high positive values indicate severe burning; negative values
// indicate post-fire enhanced regrowth relative to the pre-fire state.
//
// The result is classified into eight USGS burn severity categories
// ranging from Enhanced Regrowth (High) through to High Severity,
// with per-class area statistics reported in hectares and percentage.
//
// Supported sensors:
//   • Sentinel-2 (10 m, ~5-day revisit) — recommended for recent events
//   • Landsat 8  (30 m, 16-day revisit) — useful for longer time series
//
// WORKFLOW:
//   1. Select satellite sensor from the dropdown
//   2. Draw your study area on the map (rectangle or polygon)
//   3. Set pre-fire and post-fire date ranges using the selectors
//   4. Click "Run Analysis" — layers and statistics appear automatically
//   5. Use the Tasks tab to export the dNBR raster to Google Drive
//
// NOTE: Ensure your date ranges are long enough to capture at least
// one cloud-free image. Sentinel-2 revisits every ~5 days; Landsat 8
// every 16 days. Extend the window if the Console shows empty collections.
//
// ─────────────────────────────────────────────────────────────


// ── Map Initialisation ───────────────────────────────────────
Map.setOptions('SATELLITE');
Map.style().set('cursor', 'crosshair');


// ── Sensor Configuration ─────────────────────────────────────
var SENSOR_CONFIG = {
  'Sentinel-2': {
    collection : 'COPERNICUS/S2_SR_HARMONIZED',
    nirBand    : 'B8',
    swir2Band  : 'B12',
    rgbBands   : ['B4', 'B3', 'B2'],
    rgbMax     : 2000,
    statsScale : 10,
    exportScale: 10
  },
  'Landsat-8': {
    collection : 'LANDSAT/LC08/C02/T1_L2',
    nirBand    : 'SR_B5',
    swir2Band  : 'SR_B7',
    rgbBands   : ['SR_B4', 'SR_B3', 'SR_B2'],
    rgbMax     : 20000,
    statsScale : 30,
    exportScale: 30
  }
};

// USGS dNBR burn severity thresholds and display colours
var SEVERITY_THRESHOLDS = [-1000, -251, -101, 99, 269, 439, 659, 2000];
var SEVERITY_NAMES = [
  'NA',
  'High Severity',
  'Moderate-High Severity',
  'Moderate-Low Severity',
  'Low Severity',
  'Unburned',
  'Enhanced Regrowth — Low',
  'Enhanced Regrowth — High'
];
var SEVERITY_COLORS = [
  'ffffff',   // NA
  'a41fd6',   // High Severity
  'ff641b',   // Moderate-High
  'ffaf38',   // Moderate-Low
  'fff70b',   // Low Severity
  '0ae042',   // Unburned
  'acbe4d',   // Enhanced Regrowth Low
  '7a8737'    // Enhanced Regrowth High
];

// SLD style for classified dNBR display
var SLD_INTERVALS =
  '<RasterSymbolizer>' +
    '<ColorMap type="intervals" extended="false">' +
      '<ColorMapEntry color="#ffffff" quantity="-500"  label="NA"/>' +
      '<ColorMapEntry color="#7a8737" quantity="-250"  label="Enhanced Regrowth High"/>' +
      '<ColorMapEntry color="#acbe4d" quantity="-100"  label="Enhanced Regrowth Low"/>' +
      '<ColorMapEntry color="#0ae042" quantity="100"   label="Unburned"/>' +
      '<ColorMapEntry color="#fff70b" quantity="270"   label="Low Severity"/>' +
      '<ColorMapEntry color="#ffaf38" quantity="440"   label="Moderate-Low Severity"/>' +
      '<ColorMapEntry color="#ff641b" quantity="660"   label="Moderate-High Severity"/>' +
      '<ColorMapEntry color="#a41fd6" quantity="2000"  label="High Severity"/>' +
    '</ColorMap>' +
  '</RasterSymbolizer>';


// ── Side Panel ───────────────────────────────────────────────
var mainPanel = ui.Panel({ style: { width: '380px' } });

mainPanel.add(ui.Label({
  value: 'Burn Severity Mapping',
  style: { fontSize: '24px', fontWeight: 'bold', margin: '10px 8px 2px 8px' }
}));

mainPanel.add(ui.Label({
  value:
    'Maps wildfire and crop-residue burn severity using the Normalised ' +
    'Burn Ratio (dNBR). Select a sensor, draw your study area, set ' +
    'pre- and post-fire date windows, then run the analysis.',
  style: { fontSize: '13px', color: '#444', margin: '4px 8px 10px 8px' }
}));


// ── Sensor Selector ──────────────────────────────────────────
mainPanel.add(ui.Label({
  value: 'Satellite Sensor',
  style: { fontSize: '13px', fontWeight: 'bold', margin: '4px 0 2px 0' }
}));
mainPanel.add(ui.Label({
  value: 'Sentinel-2: 10 m, ~5-day revisit  |  Landsat-8: 30 m, 16-day revisit',
  style: { fontSize: '11px', color: '#666', margin: '0 0 4px 0' }
}));

var sensorSelector = ui.Select({
  items: ['Sentinel-2', 'Landsat-8'],
  value: 'Sentinel-2',
  placeholder: 'Select sensor'
});
mainPanel.add(sensorSelector);


// ── Date Selectors ───────────────────────────────────────────
var yearStrings  = ee.List.sequence(2015, 2025).map(function(y) { return ee.Number(y).format('%04d'); });
var monthStrings = ee.List.sequence(1, 12)     .map(function(m) { return ee.Number(m).format('%02d'); });
var dayStrings   = ee.List.sequence(1, 31)     .map(function(d) { return ee.Number(d).format('%02d'); });

function makeDateRow(labelText, defaultYear, defaultMonth, defaultDay) {
  var yearSel  = ui.Select({ placeholder: 'Year'  });
  var monthSel = ui.Select({ placeholder: 'Month' });
  var daySel   = ui.Select({ placeholder: 'Day'   });

  yearStrings.evaluate(function(list) {
    yearSel.items().reset(list);
    yearSel.setValue(defaultYear);
  });
  monthStrings.evaluate(function(list) {
    monthSel.items().reset(list);
    monthSel.setValue(defaultMonth);
  });
  dayStrings.evaluate(function(list) {
    daySel.items().reset(list);
    daySel.setValue(defaultDay);
  });

  mainPanel.add(ui.Label({
    value: labelText,
    style: { fontSize: '12px', fontWeight: 'bold', margin: '6px 0 2px 0' }
  }));
  mainPanel.add(ui.Panel({
    widgets: [yearSel, monthSel, daySel],
    layout: ui.Panel.Layout.flow('horizontal')
  }));

  return { year: yearSel, month: monthSel, day: daySel };
}

var preStart  = makeDateRow('Pre-Fire Start Date',  '2020', '08', '01');
var preEnd    = makeDateRow('Pre-Fire End Date',    '2020', '09', '10');
var postStart = makeDateRow('Post-Fire Start Date', '2020', '09', '25');
var postEnd   = makeDateRow('Post-Fire End Date',   '2020', '10', '30');

function getDateString(sel) {
  return sel.year.getValue() + '-' + sel.month.getValue() + '-' + sel.day.getValue();
}


// ── AOI Drawing Tools ────────────────────────────────────────
mainPanel.add(ui.Label({
  value: 'Study Area (AOI)',
  style: { fontSize: '13px', fontWeight: 'bold', margin: '8px 0 2px 0' }
}));
mainPanel.add(ui.Label({
  value: 'Draw a rectangle or polygon on the map to define the burned area.',
  style: { fontSize: '11px', color: '#666', margin: '0 0 4px 0' }
}));

var drawingTools = Map.drawingTools();
drawingTools.setShown(true);
while (drawingTools.layers().length() > 0) {
  drawingTools.layers().remove(drawingTools.layers().get(0));
}
drawingTools.layers().add(
  ui.Map.GeometryLayer({ geometries: null, name: 'Study Area', color: 'FF0000', shown: false })
);

function clearGeometry() {
  var layers = drawingTools.layers();
  layers.get(0).geometries().remove(layers.get(0).geometries().get(0));
}

mainPanel.add(ui.Panel({
  widgets: [
    ui.Button({
      label: '⬛ Rectangle',
      onClick: function() { clearGeometry(); drawingTools.setShape('rectangle'); drawingTools.draw(); },
      style: { width: '110px' }
    }),
    ui.Button({
      label: '🔺 Polygon',
      onClick: function() { clearGeometry(); drawingTools.setShape('polygon'); drawingTools.draw(); },
      style: { width: '110px' }
    })
  ],
  layout: ui.Panel.Layout.flow('horizontal')
}));


// ── Cloud Masking Functions ──────────────────────────────────

// Sentinel-2 SR: mask clouds (bit 10) and cirrus (bit 11) from QA60
function maskS2clouds(image) {
  var qa = image.select('QA60');
  var cloudBit  = ee.Number(2).pow(10).int();
  var cirrusBit = ee.Number(2).pow(11).int();
  var mask = qa.bitwiseAnd(cloudBit).eq(0)
               .and(qa.bitwiseAnd(cirrusBit).eq(0));
  return image.updateMask(mask).copyProperties(image, ['system:time_start']);
}

// Landsat 8 C02 L2: mask clouds (bit 3) and cloud shadow (bit 4) from QA_PIXEL
function maskL8clouds(image) {
  var qa = image.select('QA_PIXEL');
  var cloudBit  = 1 << 3;
  var shadowBit = 1 << 4;
  var mask = qa.bitwiseAnd(cloudBit).eq(0)
               .and(qa.bitwiseAnd(shadowBit).eq(0));
  return image.updateMask(mask)
    .select('SR_B.*')
    .copyProperties(image, ['system:time_start']);
}


// ── Legend Builder ───────────────────────────────────────────
function buildLegend() {
  var legend = ui.Panel({ style: { position: 'bottom-left', padding: '8px 15px' } });
  legend.add(ui.Label({ value: 'Burn Severity (dNBR)', style: { fontWeight: 'bold', fontSize: '13px', margin: '0 0 6px 0' } }));

  // Display legend in severity order (High → Enhanced Regrowth)
  var displayOrder = [1, 2, 3, 4, 5, 6, 7, 0]; // indices into SEVERITY_NAMES/COLORS
  displayOrder.forEach(function(i) {
    legend.add(ui.Panel({
      widgets: [
        ui.Label({ style: { backgroundColor: '#' + SEVERITY_COLORS[i], padding: '8px', margin: '0 0 4px 0', border: '0.5px solid #ccc' } }),
        ui.Label({ value: SEVERITY_NAMES[i], style: { margin: '0 0 4px 8px', fontSize: '12px' } })
      ],
      layout: ui.Panel.Layout.Flow('horizontal')
    }));
  });
  return legend;
}


// ── Main Analysis Function ───────────────────────────────────
function runAnalysis() {

  Map.clear();

  var sensorName = sensorSelector.getValue();
  var cfg        = SENSOR_CONFIG[sensorName];

  var preFireStart  = getDateString(preStart);
  var preFireEnd    = getDateString(preEnd);
  var postFireStart = getDateString(postStart);
  var postFireEnd   = getDateString(postEnd);

  var aoi = ee.FeatureCollection(drawingTools.layers().get(0).getEeObject());
  drawingTools.layers().get(0).setShown(false);
  drawingTools.setShape(null);
  Map.centerObject(aoi);

  print('── Burn Severity Analysis ──');
  print('Sensor: ' + sensorName);
  print('Pre-fire window:  ' + preFireStart + '  →  ' + preFireEnd);
  print('Post-fire window: ' + postFireStart + '  →  ' + postFireEnd);

  var maskFn = (sensorName === 'Sentinel-2') ? maskS2clouds : maskL8clouds;

  // Build pre- and post-fire collections
  var baseCollection = ee.ImageCollection(cfg.collection).filterBounds(aoi);

  var preRaw  = baseCollection.filterDate(preFireStart,  preFireEnd);
  var postRaw = baseCollection.filterDate(postFireStart, postFireEnd);

  print('Pre-fire collection  (raw):', preRaw);
  print('Post-fire collection (raw):', postRaw);

  var preMasked  = preRaw .map(maskFn);
  var postMasked = postRaw.map(maskFn);

  // Mosaic and clip to AOI
  var preRawMos  = preRaw .mosaic().clip(aoi);
  var postRawMos = postRaw.mosaic().clip(aoi);
  var preMos     = preMasked .mosaic().clip(aoi);
  var postMos    = postMasked.mosaic().clip(aoi);

  // NBR = (NIR − SWIR2) / (NIR + SWIR2)
  var preNBR  = preMos .normalizedDifference([cfg.nirBand, cfg.swir2Band]);
  var postNBR = postMos.normalizedDifference([cfg.nirBand, cfg.swir2Band]);

  // dNBR scaled to USGS standard (×1000)
  var dNBR = preNBR.subtract(postNBR).multiply(1000).rename('dNBR');
  print('dNBR image:', dNBR);

  // ── Add Map Layers ───────────────────────────────────────
  var rgbVis = { bands: cfg.rgbBands, max: cfg.rgbMax, gamma: 1.5 };

  Map.addLayer(aoi.draw({ color: 'FF0000', strokeWidth: 3 }), {}, 'Study Area Boundary');
  Map.addLayer(preRawMos,  rgbVis, 'Pre-Fire Image (raw)');
  Map.addLayer(postRawMos, rgbVis, 'Post-Fire Image (raw)');
  Map.addLayer(preMos,     rgbVis, 'Pre-Fire Image (cloud-masked)');
  Map.addLayer(postMos,    rgbVis, 'Post-Fire Image (cloud-masked)');
  Map.addLayer(dNBR, { min: -1000, max: 1000, palette: ['white', 'black'] }, 'dNBR Greyscale');
  Map.addLayer(dNBR.sldStyle(SLD_INTERVALS), {}, 'dNBR Classified');
  Map.add(buildLegend());

  // ── Burn Severity Statistics ─────────────────────────────
  // Classify into 8 USGS severity classes
  var thresholdImg = ee.Image(SEVERITY_THRESHOLDS);
  var classified   = dNBR.lt(thresholdImg).reduce('sum').toInt();

  var allPixels = ee.Number(
    classified.updateMask(classified)
      .reduceRegion({ reducer: ee.Reducer.count(), geometry: aoi, scale: cfg.statsScale })
      .get('sum')
  );

  var areaStats = [];
  for (var i = 0; i < 8; i++) {
    var classMask = classified.updateMask(classified.eq(i));
    var stats     = classMask.reduceRegion({ reducer: ee.Reducer.count(), geometry: aoi, scale: cfg.statsScale });
    var pixCount  = ee.Number(stats.get('sum'));
    var hectares  = pixCount.multiply(cfg.statsScale * cfg.statsScale).divide(10000);
    var percent   = pixCount.divide(allPixels).multiply(10000).round().divide(100);
    areaStats.push({ Class: SEVERITY_NAMES[i], Pixels: pixCount, Hectares: hectares, 'Percentage (%)': percent });
  }
  print('── Burned Area by Severity Class ──', areaStats);

  // ── Export ───────────────────────────────────────────────
  Export.image.toDrive({
    image      : dNBR,
    description: 'dNBR_' + sensorName.replace('-','') + '_' + postFireStart.slice(0,7),
    fileNamePrefix: 'dNBR_BurnSeverity',
    region     : aoi,
    scale      : cfg.exportScale,
    maxPixels  : 1e10,
    folder     : 'GEE_Exports'
  });

  print('── Export queued — check the Tasks tab (top right) ──');
}


// ── Run Button ───────────────────────────────────────────────
var runButton = ui.Button({
  label  : '🔥 Run Analysis',
  onClick: runAnalysis,
  style  : { margin: '12px 0 4px 0', fontWeight: 'bold' }
});
mainPanel.add(runButton);


// ── Footer ───────────────────────────────────────────────────
mainPanel.add(ui.Label({
  value: '© Remote Sensing and GIS Lab (RSGL), SKUAST-Kashmir\nDeveloped by: Shahid Shuja Shafai (shahidshafai@gmail.com)',
  style: { fontSize: '10px', color: '#888', margin: '10px 8px 8px 8px', whiteSpace: 'pre' }
}));

ui.root.add(mainPanel);
