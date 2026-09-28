// Záloha všetkých Apps Script projektov LBZ (bez Buchajtramky a Krojrentárne).
// Spúšťať funkciu zalohujVsetkyLBZ – ak skončí na časovom limite, stačí ju spustiť znova, pokračuje tam, kde prestala.
var ZALOHA_PRIECINOK = 'Záloha skriptov LBZ 2026-09-28';
var ZALOHA_PROJEKTY = [
  ['SKLAD LBZ', '1lBnAfsPnAji40Myn0OFYmqsHo9J_m7vD1_7FPJ2JUIblkZpx8yVXXujj'],
  ['Objednavky eshop', '1M1i2yz2JJvmIxhJtzyLeoZmWZOo4PV8csMbTa_CXnz1R-66YoGVWfE41'],
  ['Export sprava objedanvok', '1XuUdrkglnpigTAi5HdcdVt_lWX411i0mpfpxmHxGvWWmFw3-lxY-GtZp'],
  ['Kniha jazd (2026-09)', '1v8e6zpxFBB_WXb1b_uALDHnFgO2X183qV98sLPD9ZzGZdQjqUSm7F2EG'],
  ['Kniha jazd (2026-06)', '1EaJfjSzh_B4qZBQNoObyApU7s4p29E_bX6nmZY7ajwwLVU1JRe2Gnztb'],
  ['Formular prihlasenie', '1fUwyNRfebGcEwaLXcvvly5K8Tfb4kERYW4-MipmgDMf1ZT97sxjJYGO7'],
  ['CV automat - Legendarne buchty', '1kZf23zATTMfs8thc7Ro_B39WWKMj7NJPkoeToS-nM_FAMnB6EU4_0X1Y'],
  ['Auto-odpovede komentare', '149ofl1W3u-JQ-zPBBIFXi-Rozc_gN9w6QjBKz0749uKmr6TphCnCz4c2'],
  ['Meta Ads - Prehlad vykonnosti', '17d_MuwttHZ1JLNnAy95aKdRGDEQ3ZeVdsScbdgO-QwDHS91JsAox4hIJ'],
  ['Otvaracie hodiny sync', '1_OtUUdgZ61oTrVgTI6RYJr0n_OLbp6pDe6QE5-7sF9CzgFEevr8DADOG'],
  ['Master_dochadzka', '1CiQB68yijf9F-zwh_8iGg_giVjEH03uHWSks88UwASWBw73fSiLHvzeQ'],
  ['Dochadzka - Margetova', '1outUdWEfSGPySQx0iItMEdXFkKXb7kDdBbVpx-NfY5mMupNZxHyPMrMj'],
  ['Dochadzka - Adamek', '14yf-ho2lvwMBM4nfZg6Ta5SFKIPALXpyAFUHwUgAPJYEf8a9ujMt1ZCT'],
  ['Dochadzka - Vrana', '18VItfKQtCnNVcXyqFSbsE4nFoGdv1JhtPjCxCiE5kRPnT2K6iNUz-oKF'],
  ['Dochadzka - Demcikova', '10WGLj664cGMrCw5kTTdmjYW034faV9cyhKSa3dbfvgtwR8TTsDkIDREH'],
  ['Dochadzka - Kubej', '1PFAzpwdgDu2iQthS8SFKsm2X3d_B-meADhURnt-pcPKzfkmc0kl9tFqx'],
  ['Dochadzka - Kvietkova', '1FLVmHmuHXnGllF1MHaApILtH1s14aLINB6NA5OOujmtNDOoMkeGGOpLb'],
  ['Dochadzka - Turnova', '1NSC8KqGVNKF2yAlzeqt9eu85zhJBERlVKwASQJmC78uROmNNIcDP_BTs'],
  ['Dochadzka - Bella', '1N4A2PdWTZQ_BauGg_zN4E_HzowuG5LVo2yp2y6wfyCdmClfiksJUBhxB'],
  ['Dochadzka - Rosikova', '1xmpiJQropy6ni_U3zTE4sH4fGAV9nPPi-sOz2M2qbKxsWQAtKnTY-qhn'],
  ['Dochadzka - Tazka', '10P_nU1tXzyk6Nbe5FuY1Q78DDnFO2tERAi9hFVTsLL4LP2kxAXh4cyBO'],
  ['Dochadzka - Tesakova', '1aToygBMFRpYPjRglriu1S9dtq6GBGuiwhu-xkrOnT4nTr_KW_ZPrJa2h'],
  ['Dochadzka - Smolec', '1YY0fELZ1DiUUIxfEZU2LhJxoeWFU2czeqcupGOjiGKbRrEmcW3UDagoP'],
  ['Dochadzka - Stulrajterova', '1HquWyDyloWme6Y4my7uRpwENzW7knXVhvJX6o9V_Tv4dZ9PgdtvH_x4R'],
  ['Dochadzka - Adamekova', '1TPpRcvmdPo6h6IgVIIOCYXemwz3YEGlGxivai4loGwhnE5CWyLK_SZxh'],
  ['Dochadzka - Nepsinska', '1v0rZzM9XumnRRMNDguDc3cF5E9kOe2K22yT9JyOAmFvOLgNxCdmKrZKR'],
  ['Dochadzka - Faltanova', '1XVGwUelTcr0ibA24on8Yqcgrhmv3SiUhiQQg8bo_jGO7SBbXDZiyC6HS'],
  ['Dochadzka - Smugala', '1bf99AU_b8KpJloejgyT5LJnS21UOCDMZhAh9dN2YuLj5dPd-Rfa3gOq9'],
  ['Cestovny prikaz - Vrana', '19oeMJwOTXa_3ZfIwAhANZolW5D8FZQ_cwkpsnPcm4EHsQH-R3UOAnZNt'],
  ['Cestovny prikaz - Bella', '1VSrGoa4Mg2vPybE-yGuImPT2JIIuWeVP-GuxomKXNBx0MG8SWXCJ8TC2'],
  ['Cenniky upgates', '1E2R8YWSMPWOIC_SAVI4MvLTocy9IV8LbXZ0pM7FXfp4HBHMzg1enm5h2'],
  ['Prehlad predaja', '1NLyjCi8FnpzUDxTImRnaN4RRRSplp02HMhF2WGwX1AUHGvVqgdHBFzI0'],
  ['Cenotvorba', '1rthGn7tvQK-R5Bux1UMdoTcuTw0_3KOYliucoeIw1SxBvTksiJV0Kth2'],
  ['Struktura upgates', '145DIjRexArSuiSjlecremQI0S0deWT9zHeBrCj5vHHdCi1s_NFRAIvT2'],
  ['Ecomail segmenty', '1Dhv8dKFVNRAAnr63XgP7tue_1RflI5ThHoYx-8RWJAd9VZZWo978kSSR'],
  ['Ocisti emaily', '1bgPAeIDBkYHvrlVj49DwBDRQ8nouw2iPqF4y30HkpVo2sX6hwPJ5eKag'],
  ['Upgates VO export', '1UT5BB778MGW7_uuZeAzcUv4czhozSo8RSF90YzHsYYT25t5lLlLGrR-m'],
  ['Etikety Buchtomobil', '1vmTdrGIrTW3osPXPNBwajRdwx3juvyAi0jo6TDMChHZFXlSZxvo-hFh-'],
  ['QR kody 13x5', '1WR16vkevoP9-OAH9C0h4S8aC-6udJQJlsc3ax5yygfK_DMhMLRK2s5Io'],
  ['QR kody', '1Jp3hKr1VWKecGLF0kcnymNNDVBbTMEXYaZup-C9JiMyfsjJGK-nm2twt'],
  ['Leads z B2B reklamy - kontakty', '1ndve0ejgKcnYuN9Y5K2e9a5Dk-nQNfbru5ugPa0_eh8eKzq1ZsJr4TOH'],
  ['Bez nazvu 2026-08-24', '1Tiy6MhXT2gjfwsTus0NpAnvgjnIOUtCuzNp_dEEhIn-LdT3V40SPFHcJ'],
  ['Bez nazvu 2026-08-13 a', '1gJy1IisKfVXRuECTNBsCF3iWw6ENVZXbgU5YRZQuXesGMP8JwMB0N0Ku'],
  ['Bez nazvu 2026-08-13 b', '18Wf1a42ttkgrk5u50KShNrhXEzzKmGoOGfFsBVOjKynLooGksJXdf18b'],
  ['Bez nazvu 2026-08-11', '19N5_LtUD4YaPzAdHkbPbpMd1JDnm5feY6Othkhq9EZ4eyEpo2RTB3Y04'],
  ['Bez nazvu 2026-08-06', '130e1TEdS08WqkWUdhNKnmL8UGljgAuj7QbQcQKwj84AQud9OV5jgpsHr'],
  ['Bez nazvu 2026-07-28', '1b4N96OZ_1mxduu5XsFwomHxE38rvbZsOKRtYRZmftu2MG7fInCoMG95S'],
  ['Bez nazvu 2026-07-27', '1gZLS99LabEvJmAce-pgnxrFKa22oRceguH6ql1mQhC0MaA9ZQxVWoFIv'],
  ['Bez nazvu 2026-06-30', '1YvZ168YKI1fyaAWEJnenXbO0DIY4YQ3nSFP2T48-pKy0OmZ8oL2yfmNa']
];

function zalohujVsetkyLBZ() {
  var start = Date.now();
  var it = DriveApp.getFoldersByName(ZALOHA_PRIECINOK);
  var hlavny = it.hasNext() ? it.next() : DriveApp.createFolder(ZALOHA_PRIECINOK);
  var log = [];
  for (var i = 0; i < ZALOHA_PROJEKTY.length; i++) {
    if (Date.now() - start > 4.5 * 60 * 1000) { log.push('ČAS VYPRŠAL – spusti znova, pokračuje ďalej.'); break; }
    var nazov = ZALOHA_PROJEKTY[i][0], id = ZALOHA_PROJEKTY[i][1];
    if (hlavny.getFilesByName(nazov + '.txt').hasNext()) { log.push('preskočené (už je): ' + nazov); continue; }
    var resp = UrlFetchApp.fetch('https://script.googleapis.com/v1/projects/' + id + '/content', {
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true
    });
    if (resp.getResponseCode() !== 200) { log.push('CHYBA ' + nazov + ': ' + resp.getContentText().slice(0, 200)); continue; }
    var data = JSON.parse(resp.getContentText());
    var spojene = ['// PROJEKT: ' + nazov + '\n// Script ID: ' + id + '\n// Záloha: ' + new Date()];
    (data.files || []).forEach(function (f) {
      var ext = f.type === 'HTML' ? '.html' : (f.type === 'JSON' ? '.json' : '.gs');
      spojene.push('// ===== SÚBOR: ' + f.name + ext + ' =====\n' + f.source);
    });
    hlavny.createFile(nazov + '.json', JSON.stringify({ nazov: nazov, scriptId: id, files: data.files || [] }, null, 1), 'application/json');
    hlavny.createFile(nazov + '.txt', spojene.join('\n\n\n'), 'text/plain');
    log.push('OK ' + nazov + ' (' + (data.files || []).length + ' súborov)');
  }
  Logger.log(log.join('\n') + '\nPriečinok: ' + hlavny.getUrl());
}
