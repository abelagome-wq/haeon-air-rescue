import {AIRCRAFT_CATALOG} from './career.js';
import {ADDON_CATALOG, UPGRADE_CATALOG, getAircraftFit, getUpgradeModifiers, hasWaterCarrier} from './aircraft-loadout.js';
import {HELICOPTERS} from './flight.js';
import {cabinCapacity} from './mission-catalog.js';

const $ = id => document.getElementById(id);
export const money = value => '§' + Number(value).toLocaleString('ko-KR', {maximumFractionDigits: 2});
export const requiredEquipment = tool => ({
  traffic: 'megaphone', stop: 'megaphone', evacuate: 'megaphone', disperse: 'megaphone', greet: 'megaphone',
  bucket: 'bucket', cannon: 'cannon', harness: 'harness', gas: 'gas',
})[tool];

const sections = ['aircraft', 'equipment', 'upgrades', 'inventory'];
const sectionButtons = {aircraft: 'shopAircraft', equipment: 'shopEquipment', upgrades: 'shopUpgrades', inventory: 'shopInventory'};
const upgradeCategories = {engine: '엔진', rotor: '로터', generator: '발전기'};
const upgradeStats = {
  engine: [['최고 속도', 'speedFactor', 'speedKmh', 'km/h']],
  rotor: [['상승률', 'climbFactor', 'climb', 'm/s'], ['선회율', 'yawFactor', 'yaw', '°/s']],
  generator: [['회전수 상승', 'spoolFactor', null, '%'], ['펌프 유량', 'pumpFactor', null, '%']],
};

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function createHangarShop(career, onSelect) {
  const dialog = $('shop');
  let section = 'aircraft';
  let shownAircraft = null;
  let targetAircraft = null;
  let busy = false;
  const notice = message => { $('shopNotice').textContent = message; };

  function actionButton(item, caption, disabled, action) {
    const button = element('button', 'catalog-trade');
    button.type = 'button';
    button.dataset.item = item.id;
    button.textContent = caption;
    button.disabled = disabled;
    button.setAttribute('aria-label', item.name + ' · ' + caption);
    button.onclick = action;
    return button;
  }

  function purchaseButton(item, profile, action) {
    const short = item.price - profile.cash;
    return actionButton(item, short > 0 ? money(short) + ' 부족' : '구입 · 장착', short > 0, action);
  }

  function aircraftButton(item, profile) {
    const owned = profile.ownedAircraft.includes(item.id);
    const selected = profile.selectedAircraft === item.id;
    const short = item.price - profile.cash;
    const caption = owned ? (selected ? '선택됨' : '선택') : (short > 0 ? money(short) + ' 부족' : '구입 · 선택');
    return actionButton(item, caption, selected || (!owned && short > 0), () => transact(async () => {
      if (!owned) {
        const purchase = await career.purchaseAircraft(item.id);
        if (!purchase.ok) return purchase;
      }
      const result = await career.selectAircraft(item.id);
      if (result.ok) {
        const switched = await onSelect(item.id);
        if(switched?.ok === false)return switched;
        targetAircraft = item.id;
      }
      return result;
    }, item.name + ' 출동 기체 선택 완료'));
  }

  function aircraftPage(profile) {
    const item = AIRCRAFT_CATALOG.find(row => row.id === shownAircraft) || AIRCRAFT_CATALOG[0];
    const plane = HELICOPTERS.find(row => row.id === item.id);
    const page = element('article', 'catalog-page');
    const figure = element('figure', 'catalog-plate');
    const photo = element('img');
    photo.src = 'art/catalog/' + item.id + '.webp';
    photo.alt = item.name + ' 정측면';
    photo.onerror = () => {
      photo.onerror = null;
      photo.src = 'art/' + item.id + '.webp';
      photo.alt = item.name + ' 기체';
    };
    figure.append(photo, element('figcaption', '', item.name));
    const details = element('section', 'catalog-order');
    details.append(element('h3', '', item.name));
    const specs = element('dl', 'catalog-spec');
    for (const [label, value] of [
      ['기체 번호', item.designation],
      ['가격', money(item.price)],
      ['보유 상태', profile.ownedAircraft.includes(item.id) ? '보유' : '미보유'],
      ['최고 속도', plane.speedKmh + ' km/h'],
      ['로터 지름', plane.diameter + ' m'],
      ['승객 좌석', cabinCapacity(item.id) + '석'],
    ]) if (value != null) specs.append(element('dt', '', label), element('dd', '', value));
    details.append(specs, aircraftButton(item, profile));
    if (item.description) details.append(element('p', 'catalog-note', item.description));
    const index = element('nav', 'aircraft-index');
    index.setAttribute('aria-label', '기체 색인');
    for (const entry of AIRCRAFT_CATALOG) {
      const button = element('button', '', entry.name);
      button.type = 'button';
      button.dataset.browse = entry.id;
      button.setAttribute('aria-pressed', String(entry.id === item.id));
      button.onclick = () => { shownAircraft = entry.id; notice(''); render(); };
      index.append(button);
    }
    page.append(figure, details, index);
    return page;
  }

  function addonButton(item, profile, fit) {
    const aircraftId = targetAircraft;
    if (fit.mounted[item.slot] === item.id) {
      return actionButton(item, '분리', false, () => transact(
        () => career.unequipAddon(item.id, aircraftId), item.name + ' 분리 완료'));
    }
    if (profile.ownedEquipment.includes(item.id)) {
      return actionButton(item, '장착', false, () => transact(
        () => career.equipAddon(item.id, aircraftId), item.name + ' 장착 완료'));
    }
    if (item.id === 'cannon' && !hasWaterCarrier(profile.ownedEquipment)) {
      return actionButton(item, '물 운반 장비 필요', true);
    }
    return purchaseButton(item, profile, () => transact(
      () => career.purchaseEquipment(item.id, aircraftId), item.name + ' 구입 · 장착 완료'));
  }

  function addonRow(item, profile, fit) {
    const row = element('div', 'part-row');
    const description = element('div', 'part-description');
    if (item.slot === 'water') description.append(element('b', '', item.name));
    const owned = profile.ownedEquipment.includes(item.id);
    const mounted = fit.mounted[item.slot] === item.id;
    const details = [];
    if (item.capacityLitres) {
      const current = fit.water?.capacityLitres ?? 0;
      details.push((mounted ? '' : current + ' → ') + item.capacityLitres + ' L');
    }
    details.push(mounted ? '장착 중' : owned ? '보유' : money(item.price));
    if (mounted && item.id === 'cannon' && !fit.water) details.push('물 운반 장비를 장착해야 사용 가능');
    description.append(element('span', '', details.join(' · ')));
    row.append(description, addonButton(item, profile, fit));
    return row;
  }

  function equipmentPage(profile) {
    const fit = getAircraftFit(profile, targetAircraft);
    const page = element('section', 'equipment-page');
    for (const [kind, name, detail] of [
      ['bucket', '물양동이', '기체 아래에 매달아 물을 담고 현장 위에서 투하합니다.'],
      ['tank', '물탱크', '동체에 고정해 물을 운반하고 현장 위에서 방류합니다.'],
    ]) {
      const card = element('article', 'equipment-card');
      if (kind === 'bucket') card.dataset.equipment = 'bucket';
      card.append(element('h3', '', name), element('p', '', detail));
      for (const item of ADDON_CATALOG.filter(part => part.kind === kind)) card.append(addonRow(item, profile, fit));
      page.append(card);
    }
    for (const item of ADDON_CATALOG.filter(part => part.slot !== 'water')) {
      const card = element('article', 'equipment-card');
      card.dataset.equipment = item.id;
      card.append(element('h3', '', item.name), element('p', '', item.description), addonRow(item, profile, fit));
      page.append(card);
    }
    return page;
  }

  function upgradePreview(category, plane, before, after) {
    return upgradeStats[category].map(([name, factor, spec, unit]) => {
      const base = spec ? plane[spec] : 100;
      const value = fit => (base * fit[factor]).toLocaleString('ko-KR', {maximumFractionDigits:1});
      const change = value(before) === value(after) ? value(before) : value(before) + ' → ' + value(after);
      return name + ' ' + change + ' ' + unit;
    }).join(' · ');
  }

  function upgradesPage(profile) {
    const aircraftId = targetAircraft;
    const fit = getAircraftFit(profile, aircraftId);
    const plane = HELICOPTERS.find(item => item.id === aircraftId);
    const page = element('section', 'upgrade-page');
    for (const [category, title] of Object.entries(upgradeCategories)) {
      const level = fit.levels[category];
      const card = element('article', 'equipment-card');
      card.append(element('h3', '', title + ' · ' + (level ? level + '단계' : '기본형')));
      for (const item of UPGRADE_CATALOG.filter(part => part.category === category)) {
        const row = element('div', 'part-row');
        const info = element('div', 'part-description');
        info.append(element('b', '', item.name));
        const preview = getUpgradeModifiers({...fit.levels, [category]: item.tier});
        const reference = item.tier < level ? preview : fit.modifiers;
        info.append(element('span', '', upgradePreview(category, plane, reference, preview)));
        if (item.tier > level) info.append(element('span', 'part-price', money(item.price)));
        let button;
        if (item.tier <= level) button = actionButton(item, item.tier === level ? '장착 중' : '개량 완료', true);
        else if (item.tier > level + 1) button = actionButton(item, (item.tier - 1) + '단계 필요', true);
        else button = purchaseButton(item, profile, () => transact(
          () => career.purchaseUpgrade(item.id, aircraftId), plane.name + ' · ' + item.name + ' 개량 완료'));
        row.append(info, button);
        card.append(row);
      }
      page.append(card);
    }
    return page;
  }

  function inventoryPage(profile) {
    const sheet = element('div', 'inventory-sheet');
    const table = element('table');
    table.append(element('caption', '', '보유 기체별 정비 현황'));
    const head = element('thead');
    const columns = element('tr');
    for (const label of ['기체', '성능 개량', '장착 부품']) {
      const th = element('th', '', label);
      th.scope = 'col';
      columns.append(th);
    }
    head.append(columns);
    const body = element('tbody');
    for (const plane of AIRCRAFT_CATALOG.filter(item => profile.ownedAircraft.includes(item.id))) {
      const row = element('tr');
      const heading = element('th', '', plane.name);
      heading.scope = 'row';
      row.append(heading);
      const fit = getAircraftFit(profile, plane.id);
      const upgrades = Object.entries(upgradeCategories).filter(([key]) => fit.levels[key] > 0)
        .map(([key, label]) => label + ' ' + fit.levels[key] + '단계');
      const mounted = ADDON_CATALOG.filter(part => fit.mounted[part.slot] === part.id);
      row.append(element('td', '', upgrades.join(' · ') || '기본형'),
        element('td', '', mounted.map(part => part.name).join(' · ') || '없음'));
      body.append(row);
    }
    table.append(head, body);
    sheet.append(table);
    return sheet;
  }

  function render() {
    const profile = career.snapshot();
    if (!profile) return;
    const focused = document.activeElement;
    const key = focused?.dataset.item ? 'item' : focused?.dataset.browse ? 'browse' : null;
    const active = key && focused.dataset[key];
    $('shopBalance').textContent = money(profile.cash);
    for (const name of sections) $(sectionButtons[name])?.setAttribute('aria-pressed', String(name === section));
    const tuning = section === 'equipment' || section === 'upgrades';
    $('shopTarget').hidden = !tuning;
    if (tuning) {
      if (!profile.ownedAircraft.includes(targetAircraft)) targetAircraft = profile.selectedAircraft;
      const select = $('shopTargetSelect');
      select.replaceChildren(...AIRCRAFT_CATALOG.filter(item => profile.ownedAircraft.includes(item.id))
        .map(item => new Option(item.name, item.id)));
      select.value = targetAircraft;
    }
    const pageRoot = $('shopItems');
    pageRoot.dataset.section = section;
    $('shopDescription').textContent = {
      aircraft: '색인에서 기체를 골라 제원과 가격을 확인하세요.',
      equipment: '보유 부품은 기체마다 장착하거나 분리할 수 있습니다. 물양동이와 물탱크는 하나만 장착할 수 있습니다.',
      upgrades: '선택한 기체에 1단계부터 차례로 적용합니다. 수치는 현재 성능과 개량 후 성능입니다.',
      inventory: '',
    }[section];
    const pages = {aircraft: aircraftPage, equipment: equipmentPage, upgrades: upgradesPage, inventory: inventoryPage};
    pageRoot.replaceChildren(pages[section](profile));
    if (active) {
      const replacement = [...pageRoot.querySelectorAll('button')].find(button => button.dataset[key] === active);
      const next = replacement?.disabled ? replacement.closest('article')?.querySelector('button:not(:disabled)') : replacement;
      (next || $(sectionButtons[section])).focus({preventScroll: true});
    }
  }

  async function transact(action, successMessage) {
    if (busy) return;
    busy = true;
    dialog.setAttribute('aria-busy', 'true');
    notice('정비 기록을 저장하고 있습니다.');
    try {
      const result = await action();
      notice(result.ok ? successMessage : result.message);
    } catch (error) {
      notice(error.message || '정비 기록을 확인해 주세요.');
    } finally {
      busy = false;
      dialog.removeAttribute('aria-busy');
      render();
    }
  }

  function showSection(name) {
    section = name;
    notice('');
    render();
  }
  for (const name of sections) {
    const button = $(sectionButtons[name]);
    if (button) button.onclick = () => showSection(name);
  }
  $('shopTargetSelect').onchange = event => {
    targetAircraft = event.target.value;
    notice('');
    render();
  };
  $('closeShop').onclick = () => dialog.close();
  dialog.addEventListener('padview',event=>{
    const {edge}=event.detail;
    if(!edge(4)&&!edge(5))return;
    const step=edge(4)?-1:1;
    showSection(sections[(sections.indexOf(section)+step+sections.length)%sections.length]);
    $(sectionButtons[section]).focus({preventScroll:true});
    event.preventDefault();
  });
  career.subscribe(() => { if (dialog.open && !busy) render(); });
  return {
    open(name = 'aircraft') {
      const profile = career.snapshot();
      if (!profile) return;
      targetAircraft = profile.selectedAircraft;
      shownAircraft ??= AIRCRAFT_CATALOG.find(item => !profile.ownedAircraft.includes(item.id))?.id || profile.selectedAircraft;
      showSection(sections.includes(name) ? name : 'aircraft');
      if (!dialog.open) dialog.showModal();
      $('closeShop').focus();
    },
    get openNow() { return dialog.open; },

  };
}
