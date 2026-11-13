const directions = ['북', '북동', '동', '남동', '남', '남서', '서', '북서'];

function describe(sample) {
  if (!sample) return {conditions: '', details: '', compactWind: ''};

  const calm = sample.fromDeg === null || sample.speed < 0.05;
  let compactWind = '무풍';
  let wind = compactWind;
  if (!calm) {
    const bearing = (Math.round(sample.fromDeg) % 360 + 360) % 360;
    const direction = directions[Math.round(bearing / 45) % 8] + '풍';
    const speed = sample.speed.toFixed(1) + ' m/s';
    compactWind = direction + ' ' + speed;
    wind = direction + ' ' + bearing + '° · ' + speed;
  }
  const visibility = sample.visibility < 1000
    ? Math.round(sample.visibility) + ' m'
    : (sample.visibility / 1000).toFixed(1) + ' km';
  const gust = sample.gustSpeed >= sample.speed + 1
    ? ' · 예상 돌풍 ' + sample.gustSpeed.toFixed(1) + ' m/s'
    : '';
  return {conditions: sample.label + ' · ' + wind, details: '시정 ' + visibility + gust, compactWind};
}

function show(id, value) {
  const element = document.getElementById(id);
  if (element.textContent !== value) element.textContent = value;
}

export function updateWeatherForecast(sample) {
  const {conditions, details} = describe(sample);
  show('departureConditions', conditions);
  show('departureVisibility', details);
}

export function updateWeatherDisplay(sample) {
  const {conditions, details, compactWind} = describe(sample);
  document.getElementById('flightWeather').hidden = !sample;
  show('flightConditions', conditions);
  show('flightVisibility', details);
  show('touchWind', compactWind);
}
