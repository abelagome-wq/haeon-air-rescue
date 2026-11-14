// IDs and model paths are save/asset identifiers. Name is the in-game name,
// designation is the identifier shown in the hangar. Speeds and handling are game values.
function aircraft(id, name, designation, stem, price, flight, rotor, service, seats, pilot, tail = 'TailRotor') {
  const [speedKmh, diameter, bank, slide, pitch, climb, yaw] = flight;
  const [emptyKg, usefulLb] = rotor;
  const [gallons, burn, damage, repairRaw] = service;
  return Object.freeze({id, name, designation, price, path:'models/fleet/'+stem+'.glb',
    speedKmh, diameter, bank, slide, pitch, climb, yaw, emptyKg, usefulLb, gallons, burn, damage,
    repairPrice:repairRaw/65536, seats, pilot:Object.freeze(pilot), tail});
}

export const FLEET = Object.freeze([
  aircraft('SCWZR300','해온 솔새','HAEON 301','schweizer/Schweizer-300',3400,
    [153,8.18,41.80,12.29,13.15,4.4,58.9],[474,1062],[38.5,87.9,495,39321],1,[.422,1.102,.63,.89]),
  aircraft('JETRANG','해온 길잡이','HAEON 302','bell/Bell-206-JetRanger',7800,
    [232,11.28,42.67,14.02,19.23,7.1,58.9],[844,1548],[91.2,230.8,604,83230],6,[.425,1.246,1.69,.94]),
  aircraft('HUGH500','해온 꺾쇠','HAEON 303','md/MD-500/MD-500',8800,
    [232,8.03,45.27,14.02,20.10,8.2,68.7],[493,1987],[65.9,197.8,659,87162],5,[.365,.910,.73,.89]),
  aircraft('MD520','해온 소리매','HAEON 304','md/MD-520N/MD-520N',11000,
    [250,8.33,45.27,19.23,21.84,9.3,78.5],[742,2426],[65.9,285.7,659,85196],4,[.365,.910,.73,.89],null),
  aircraft('BELL212','해온 돌개','HAEON 305','bell/Bell-212-TwinHuey',13500,
    [206,14.69,27.91,9.68,18.36,6.6,39.3],[2765,5062],[214.3,813.2,1000,85196],14,[.540,1.246,2.35,.94]),
  aircraft('AGUSTA','해온 화살비','HAEON 306','europe/Agusta-A109A/Agusta-A109A',16500,
    [285,11,52.22,14.02,25.31,10.4,58.9],[1418,2207],[148.4,571.4,714,144179],7,[.480,1.255,1.43,.93]),
  aircraft('DAUPHIN','해온 물제비','HAEON 307','europe/Dauphin-2/Dauphin-2',18500,
    [260,11.68,34.86,12.29,25.31,8.2,49.1],[1806,3525],[302.2,835.2,769,144179],12,[.480,1.315,1.60,.93],'FenestronRotor'),
  aircraft('MDEXPLRR','해온 밤여울','HAEON 308','md/MD-Explorer/MD-Explorer',20500,
    [274,10.3,33.99,14.02,24.44,13.7,68.7],[1458,3085],[159.3,439.6,769,150732],9,[.470,1.100,1.11,.92],null),
  aircraft('APACHE','해온 검독수리','HAEON 309','military/AH-64-Apache',50000,
    [295,14.63,55.69,23.57,29.65,15.3,98],[10267*.45359237,1904],[148.4,571.4,1000,327680],0,[0,2.210,1.10,.92]),

  aircraft('GARAM','해온 가람','HAEON 310','service/GARAM',5800,
    [205,10.06,40,12,16,5.1,62],[700,1140],[48,105,510,47000],3,[.37,.85,1.12,.9]),
  aircraft('GIRIN','해온 기린','HAEON 311','service/GIRIN',41000,
    [190,21.95,23,8,14,6.2,34],[8700,19000],[620,1260,1150,211000],0,[.66,1.92,6.5,.96]),
  aircraft('NOEUL','해온 노을','HAEON 312','service/NOEUL',26300,
    [232,21.29,30,10,18,7.4,45],[6900,9100],[495,950,1070,162000],18,[.62,1.75,3.75,.96]),
  aircraft('HEUKSON','해온 흑솔','HAEON 313','service/HEUKSON',37200,
    [308,17.30,47,17,26,10.6,66],[8200,6500],[445,1080,1120,265000],6,[0,1.85,2.95,.95]),
  aircraft('GYEOPNAL','해온 겹날','HAEON 314','service/GYEOPNAL',30800,
    [245,15.90,34,13,20,9.9,76],[6550,9500],[385,850,1020,172000],12,[.54,1.6,2.65,.95],'SecondMainRotor'),
  aircraft('BYEOL','해온 별무리','HAEON 315','service/BYEOL',17200,
    [235,15.70,35,12,18,8.5,53],[3850,5500],[265,620,840,121000],10,[.5,1.46,2.65,.94]),
  aircraft('MARU','해온 마루','HAEON 316','service/MARU',21600,
    [262,13.20,41,15,22,10.2,62],[2840,4950],[230,540,830,127000],10,[.47,1.37,2.22,.94]),
  aircraft('DURUM','해온 두루미','HAEON 317','service/DURUM',25200,
    [258,15.80,37,12,20,8.9,54],[5050,6900],[325,730,960,147000],9,[.54,1.53,2.95,.95]),
  aircraft('DUSOL','해온 두솔','HAEON 318','service/DUSOL',44500,
    [291,18.29,28,11,18,8,41],[10800,21000],[750,1420,1310,224000],28,[.65,1.89,5.18,.96],'SecondMainRotor'),
  aircraft('HAEMOR','해온 해마루','HAEON 319','service/HAEMOR',28700,
    [218,18.90,31,11,19,7.7,50],[6200,8300],[430,810,990,154000],15,[.60,1.86,3.17,.95]),
  aircraft('SANBI','해온 산비','HAEON 320','service/SANBI',34800,
    [286,13,49,18,27,11.4,72],[5050,5600],[310,790,940,192000],0,[0,1.67,2.26,.94]),
]);
