// Token Launch Radar Web Application (Offline, Zero-Network)
// Visualizes pre-token protocol valuations, multi-chain metrics, and actionable farm plans.
// Consumes window.RADAR compiled by the radar engine.

(function () {
  'use strict';

  var radarState = window.RADAR;
  if (!radarState) return;

  var rootContainer = document.getElementById('board');
  if (!rootContainer) return;

  var appState = {
    searchQuery: '',
    categoryFilter: 'all',
    activeTab: 'pre-token',
    sortColumn: 'implied',
    sortDirection: -1,
    activeProtocolSlug: null
  };

  var currencyFormatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  });

  function formatCurrency(val) {
    if (val === null || val === undefined || !Number.isFinite(val)) return 'n/a';
    var absVal = Math.abs(val);
    if (absVal >= 1e9) return '$' + (val / 1e9).toFixed(2) + 'B';
    if (absVal >= 1e6) return '$' + (val / 1e6).toFixed(1) + 'M';
    if (absVal >= 1e3) return '$' + Math.round(val / 1e3) + 'K';
    return currencyFormatter.format(val);
  }

  function formatPercent(val) {
    if (val === null || val === undefined || !Number.isFinite(val)) return 'n/a';
    return (val > 0 ? '+' : '') + val.toFixed(2) + '%';
  }

  function formatAgeDays(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }

  function computeImpliedValuation(row, constants) {
    var rawGrowth = row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d;
    var clampedGrowth = Math.min(constants.growth_cap, Math.max(constants.growth_floor, rawGrowth));
    var growthWeightMult = 1 + (clampedGrowth / 100) * constants.growth_weight;
    var effectiveAge = row.age_days === null || row.age_days === undefined ? constants.unknown_age_days : row.age_days;
    var clampedAge = Math.min(Math.max(effectiveAge, 0), constants.maturity_days);
    var maturityMult = constants.maturity_floor + (clampedAge / constants.maturity_days) * constants.maturity_range;
    return Math.max(1, Math.round(row.tvl_usd * constants.base_multiple * growthWeightMult * maturityMult));
  }

  function createDomElement(tagName, attributes) {
    var elem = document.createElement(tagName);
    if (attributes) {
      for (var attr in attributes) {
        if (!Object.prototype.hasOwnProperty.call(attributes, attr)) continue;
        var value = attributes[attr];
        if (attr === 'class') elem.className = value;
        else if (attr === 'text') elem.textContent = value;
        else if (attr === 'html') elem.innerHTML = value;
        else if (attr.indexOf('on') === 0) elem.addEventListener(attr.slice(2), value);
        else if (value !== null && value !== undefined) elem.setAttribute(attr, value);
      }
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) {
        for (var c = 0; c < child.length; c++) if (child[c]) elem.appendChild(child[c]);
      } else if (typeof child === 'string') {
        elem.appendChild(document.createTextNode(child));
      } else {
        elem.appendChild(child);
      }
    }
    return elem;
  }

  function primaryChainName(protocol) {
    return protocol.chains && protocol.chains.length > 0 ? protocol.chains[0] : 'its primary network';
  }

  function capitalTierUsd(protocol) {
    if (protocol.tvl_usd >= 5e9) return 250;
    if (protocol.tvl_usd >= 1e9) return 150;
    if (protocol.tvl_usd >= 1e8) return 100;
    return 50;
  }

  function minRetentionDays(ageDays) {
    if (ageDays === null || ageDays === undefined) return 30;
    if (ageDays < 180) return 60;
    if (ageDays < 365) return 45;
    return 30;
  }

  function buildFarmActionDescription(protocol, capital, chain) {
    var cat = (protocol.category || '').toLowerCase();
    var pName = protocol.name;
    if (cat.indexOf('lend') >= 0 || cat.indexOf('cdp') >= 0 || cat.indexOf('collateral') >= 0) {
      return 'Supply $' + capital + ' of USDC to ' + pName + ' on ' + chain + ' and keep the position open.';
    }
    if (cat.indexOf('dex') >= 0 || cat.indexOf('yield') >= 0 || cat.indexOf('leveraged farm') >= 0) {
      return 'Provide $' + capital + ' of liquidity to ' + pName + "'s main pool on " + chain + ' and keep the position open.';
    }
    if (cat.indexOf('bridge') >= 0) {
      return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + pName + ' and use the bridged funds in its app.';
    }
    if (cat.indexOf('staking') >= 0 || cat.indexOf('restak') >= 0) {
      return "Stake $" + capital + " of the chain's staking asset through " + pName + ' and keep the receipt.';
    }
    if (cat.indexOf('perpetual') >= 0 || cat.indexOf('derivative') >= 0) {
      return 'Deposit $' + capital + ' of USDC as margin on ' + pName + ' and open one small hedge.';
    }
    if (cat.indexOf('prediction') >= 0) {
      return 'Fund $' + capital + ' and place one market position on ' + pName + '.';
    }
    if (cat.indexOf('curator') >= 0 || cat.indexOf('allocator') >= 0) {
      return 'Deposit $' + capital + ' into a ' + pName + ' vault on ' + chain + ' and keep the shares.';
    }
    if (cat.indexOf('stable') >= 0) {
      return 'Mint or deposit $' + capital + ' of the stable asset through ' + pName + ' on ' + chain + '.';
    }
    if (cat.indexOf('rwa') >= 0) {
      return "Mint $" + capital + " of the protocol's yield asset on " + chain + ' and hold it.';
    }
    if (cat.indexOf('insurance') >= 0) {
      return 'Buy $' + capital + ' of cover from ' + pName + ' on ' + chain + ' and keep the policy.';
    }
    return 'Deposit $' + capital + ' of USDC into ' + pName + ' on ' + chain + ' and keep the position open.';
  }

  function formatStepSummary(step) {
    var text = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (text.length > 600) text = text.slice(0, 596) + '...';
    if (text.length < 20) text += " Hold the position and check the protocol's own page.";
    return text;
  }

  function generateProtocolFarmPlan(protocol) {
    var chain = primaryChainName(protocol);
    var capital = capitalTierUsd(protocol);
    var retentionWindow = minRetentionDays(protocol.age_days);
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: buildFarmActionDescription(protocol, capital, chain), cost: '$' + capital + ' of capital and about $' + (capital >= 150 ? 8 : 4) + ' of gas', time: '15 minutes to set up' },
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + retentionWindow + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: retentionWindow + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(formatStepSummary);
  }

  function synchronizeUrlState() {
    var hashParams = window.location.hash.replace(/^#/, '');
    if (!hashParams) return;
    var parsed = new URLSearchParams(hashParams);
    if (parsed.has('q')) appState.searchQuery = parsed.get('q');
    if (parsed.has('p')) appState.activeProtocolSlug = parsed.get('p');
    if (parsed.has('category')) appState.categoryFilter = parsed.get('category');
  }

  function persistUrlState() {
    var params = new URLSearchParams();
    if (appState.searchQuery) params.set('q', appState.searchQuery);
    if (appState.categoryFilter !== 'all') params.set('category', appState.categoryFilter);
    if (appState.activeProtocolSlug) params.set('p', appState.activeProtocolSlug);
    var queryString = params.toString();
    if (queryString) {
      window.history.replaceState(null, '', '#' + queryString);
    } else {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  }

  function filteredProtocolRows() {
    var term = appState.searchQuery.trim().toLowerCase();
    return radarState.rows.filter(function (row) {
      if (appState.categoryFilter !== 'all' && row.category !== appState.categoryFilter) return false;
      if (!term) return true;
      var searchableText = [row.name, row.slug, row.category, (row.chains || []).join(' ')].join(' ').toLowerCase();
      return searchableText.indexOf(term) >= 0;
    });
  }

  function sortProtocolCollection(items) {
    var field = appState.sortColumn;
    var direction = appState.sortDirection;
    return items.slice().sort(function (first, second) {
      var valA, valB;
      if (field === 'name') {
        valA = first.name.toLowerCase();
        valB = second.name.toLowerCase();
      } else if (field === 'tvl') {
        valA = first.tvl_usd;
        valB = second.tvl_usd;
      } else if (field === 'growth') {
        valA = first.change_7d === null ? -Infinity : first.change_7d;
        valB = second.change_7d === null ? -Infinity : second.change_7d;
      } else if (field === 'age') {
        valA = first.age_days === null ? Infinity : first.age_days;
        valB = second.age_days === null ? Infinity : second.age_days;
      } else {
        valA = first.implied_value_usd;
        valB = second.implied_value_usd;
      }
      if (valA < valB) return -direction;
      if (valA > valB) return direction;
      return first.slug < second.slug ? -1 : first.slug > second.slug ? 1 : 0;
    });
  }

  function renderAppHeader() {
    return createDomElement('header', { class: 'top' },
      createDomElement('div', { class: 'brand' },
        createDomElement('span', { class: 'mark' }),
        createDomElement('span', { class: 'brand-name', text: 'Token Radar Pro' })
      ),
      createDomElement('div', { class: 'top-meta' },
        createDomElement('span', { text: 'Snapshot ' + radarState.as_of }),
        createDomElement('span', { text: 'DefiLlama universe' }),
        createDomElement('span', { text: radarState.model_version + ' engine' })
      )
    );
  }

  function renderHeroBanner() {
    return createDomElement('section', { class: 'lede' },
      createDomElement('div', null,
        createDomElement('h1', { text: radarState.watchlist_size + ' watchlist protocols, ranked by implied valuation' }),
        createDomElement('p', { text: 'The watchlist represents the floor: every protocol with at least $' + Math.round(radarState.floor_usd / 1e6) + 'M TVL and no live token on record. The radar adds ' + radarState.early_size + ' pre-token opportunities discovered below the floor.' })
      ),
      createDomElement('div', { class: 'facts' },
        createDomElement('div', { class: 'fact' }, createDomElement('span', { text: 'Watchlist coverage' }), createDomElement('b', { text: radarState.watchlist_size + ' / ' + radarState.watchlist_size })),
        createDomElement('div', { class: 'fact' }, createDomElement('span', { text: 'Total pre-token rows' }), createDomElement('b', { text: String(radarState.board_size) })),
        createDomElement('div', { class: 'fact' }, createDomElement('span', { text: 'Sub-floor early radar' }), createDomElement('b', { text: String(radarState.early_size) })),
        createDomElement('div', { class: 'fact' }, createDomElement('span', { text: 'Live tokens benchmark' }), createDomElement('b', { text: String(radarState.live_size) }))
      )
    );
  }

  function renderFilterControls() {
    var uniqueCategories = Array.from(new Set(radarState.rows.map(function (item) { return item.category || 'Other'; }))).sort();
    var searchField = createDomElement('input', {
      type: 'search',
      id: 'q',
      placeholder: 'Search by protocol name, chain, or category...',
      value: appState.searchQuery,
      'aria-label': 'Search protocols'
    });
    searchField.addEventListener('input', function () {
      appState.searchQuery = searchField.value;
      persistUrlState();
      renderAppView();
    });

    var categoryDropdown = createDomElement('select', { id: 'category', 'aria-label': 'Select category' },
      createDomElement('option', { value: 'all', text: 'All categories' }),
      uniqueCategories.map(function (cat) {
        return createDomElement('option', { value: cat, text: cat, selected: cat === appState.categoryFilter ? 'selected' : null });
      })
    );
    categoryDropdown.addEventListener('change', function () {
      appState.categoryFilter = categoryDropdown.value;
      persistUrlState();
      renderAppView();
    });

    var preTokenBtn = createDomElement('button', {
      type: 'button',
      'aria-pressed': appState.activeTab === 'pre-token' ? 'true' : 'false',
      text: 'Pre-token radar',
      onclick: function () { appState.activeTab = 'pre-token'; renderAppView(); }
    });
    var liveTokensBtn = createDomElement('button', {
      type: 'button',
      'aria-pressed': appState.activeTab === 'live' ? 'true' : 'false',
      text: 'Live token comps',
      onclick: function () { appState.activeTab = 'live'; renderAppView(); }
    });

    var visibleCount = appState.activeTab === 'pre-token' ? filteredProtocolRows().length + ' pre-token protocols' : radarState.live.length + ' live tokens';
    return createDomElement('div', { class: 'controls' },
      createDomElement('div', { class: 'field' }, createDomElement('label', { for: 'q', text: 'Search' }), searchField),
      createDomElement('div', { class: 'field' }, createDomElement('label', { for: 'category', text: 'Category' }), categoryDropdown),
      createDomElement('div', { class: 'field' }, createDomElement('span', { class: 'sub', text: 'View mode' }), createDomElement('div', { class: 'tabs' }, preTokenBtn, liveTokensBtn)),
      createDomElement('span', { class: 'count', text: visibleCount })
    );
  }

  function renderColumnHeader(colKey, displayLabel) {
    return createDomElement('th', { scope: 'col' },
      createDomElement('button', {
        type: 'button',
        onclick: function () {
          if (appState.sortColumn === colKey) {
            appState.sortDirection = -appState.sortDirection;
          } else {
            appState.sortColumn = colKey;
            appState.sortDirection = -1;
          }
          renderAppView();
        }
      },
        displayLabel,
        appState.sortColumn === colKey ? createDomElement('span', { 'aria-hidden': 'true', text: appState.sortDirection < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function renderRankingTable() {
    var dataset = sortProtocolCollection(filteredProtocolRows());
    if (dataset.length === 0) {
      return createDomElement('div', { class: 'panel' },
        createDomElement('div', { class: 'empty' },
          createDomElement('h2', { text: 'No matching protocols discovered' }),
          createDomElement('p', { text: 'Reset search parameters or select all categories to view the full ranking.' }),
          createDomElement('button', {
            class: 'button primary',
            type: 'button',
            text: 'Clear active filters',
            onclick: function () {
              appState.searchQuery = '';
              appState.categoryFilter = 'all';
              persistUrlState();
              renderAppView();
            }
          })
        )
      );
    }

    var highestImpliedValuation = dataset[0].implied_value_usd || 1;
    var tableBody = createDomElement('tbody');
    dataset.forEach(function (protocol) {
      var formattedGrowth = protocol.change_7d === null ? 'n/a' : formatPercent(protocol.change_7d);
      var growthModifier = protocol.change_7d === null ? '' : protocol.change_7d >= 0 ? 'pos' : 'neg';
      var tableRow = createDomElement('tr', {
        'data-selected': appState.activeProtocolSlug === protocol.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openProtocolDetailModal(protocol.slug); },
        onkeydown: function (event) {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openProtocolDetailModal(protocol.slug);
          }
        }
      },
        createDomElement('td', { class: 'num', text: String(protocol.rank) }),
        createDomElement('td', null,
          createDomElement('div', { class: 'name' },
            createDomElement('b', { text: protocol.name }),
            createDomElement('span', { class: 'sub', text: (protocol.category || 'Other') + ' on ' + (protocol.chains && protocol.chains.length ? protocol.chains.slice(0, 2).join(', ') : 'mainnet') })
          )
        ),
        createDomElement('td', { class: 'num', text: formatCurrency(protocol.tvl_usd) }),
        createDomElement('td', { class: 'num ' + growthModifier, text: formattedGrowth }),
        createDomElement('td', { class: 'num', text: formatAgeDays(protocol.age_days) }),
        createDomElement('td', null,
          createDomElement('div', { class: 'implied' },
            createDomElement('div', { class: 'bar', 'aria-hidden': 'true' },
              createDomElement('i', { style: 'width:' + Math.max(3, Math.round((protocol.implied_value_usd / highestImpliedValuation) * 100)) + '%' })
            ),
            createDomElement('span', { class: 'num', text: formatCurrency(protocol.implied_value_usd) })
          )
        ),
        createDomElement('td', null, createDomElement('span', { class: 'status', text: 'pre-token' }))
      );
      tableBody.appendChild(tableRow);
    });

    return createDomElement('div', { class: 'panel' },
      createDomElement('div', { class: 'table-wrap' },
        createDomElement('table', null,
          createDomElement('caption', { class: 'sub', text: 'Pre-token protocols ranked strictly by implied valuation. Click any row to inspect valuation mechanics and actionable farming guides.' }),
          createDomElement('thead', null,
            createDomElement('tr', null,
              renderColumnHeader('implied', 'Rank'),
              renderColumnHeader('name', 'Protocol'),
              renderColumnHeader('tvl', 'TVL'),
              renderColumnHeader('growth', '7d delta'),
              renderColumnHeader('age', 'Age'),
              renderColumnHeader('implied', 'Implied Valuation'),
              createDomElement('th', { scope: 'col', text: 'Status' })
            )
          ),
          tableBody
        )
      )
    );
  }

  function renderLiveTokenBenchmarkTable() {
    var tableBody = createDomElement('tbody');
    radarState.live.forEach(function (token) {
      tableBody.appendChild(createDomElement('tr', null,
        createDomElement('td', { class: 'num', text: 'traded' }),
        createDomElement('td', null,
          createDomElement('div', { class: 'name' },
            createDomElement('b', { text: token.name }),
            createDomElement('span', { class: 'sub', text: (token.category || 'Other') + ' on ' + (token.chains && token.chains.length ? token.chains.slice(0, 2).join(', ') : 'mainnet') })
          )
        ),
        createDomElement('td', { class: 'num', text: formatCurrency(token.tvl_usd) }),
        createDomElement('td', { class: 'num ' + (token.change_7d !== null && token.change_7d >= 0 ? 'pos' : 'neg'), text: formatPercent(token.change_7d) }),
        createDomElement('td', { class: 'num', text: formatCurrency(token.mcap_usd) }),
        createDomElement('td', null, createDomElement('span', { class: 'status', text: 'live token' }))
      ));
    });

    return createDomElement('div', { class: 'panel' },
      createDomElement('div', { class: 'table-wrap' },
        createDomElement('table', null,
          createDomElement('caption', { class: 'sub', text: 'Live token comparables. These protocols have active secondary markets and traded tokens, providing empirical market cap benchmarks.' }),
          createDomElement('thead', null,
            createDomElement('tr', null,
              createDomElement('th', { scope: 'col', text: 'Status' }),
              createDomElement('th', { scope: 'col', text: 'Protocol' }),
              createDomElement('th', { scope: 'col', text: 'TVL' }),
              createDomElement('th', { scope: 'col', text: '7d delta' }),
              createDomElement('th', { scope: 'col', text: 'Market Cap' }),
              createDomElement('th', { scope: 'col', text: 'Market State' })
            )
          ),
          tableBody
        )
      )
    );
  }

  function renderModelDescriptionSection() {
    var cfg = radarState.model;
    return createDomElement('section', { class: 'panel model' },
      createDomElement('h2', { text: 'Valuation & Ranking Algorithm' }),
      createDomElement('p', { class: 'sub', text: 'Implied value follows deterministically from protocol fundamentals in the sealed snapshot. No special cases, no arbitrary overrides.' }),
      createDomElement('div', { class: 'formula' },
        'implied = round( tvl_usd x ' + cfg.base_multiple + ' x (1 + clamp(change_7d, ' + cfg.growth_floor + ', ' + cfg.growth_cap + ') / 100 x ' + cfg.growth_weight + ') x (' + cfg.maturity_floor + ' + min(age_days, ' + cfg.maturity_days + ') / ' + cfg.maturity_days + ' x ' + cfg.maturity_range + ') )'
      ),
      createDomElement('p', { class: 'sub', text: 'Base valuation leverages a ' + cfg.base_multiple + 'x multiple of TVL, adjusted by 7-day trajectory and protocol maturity across DefiLlama operational history.' })
    );
  }

  var detailModal = createDomElement('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  detailModal.addEventListener('close', function () {
    appState.activeProtocolSlug = null;
    persistUrlState();
  });

  function openProtocolDetailModal(slug) {
    var protocol = radarState.rows.filter(function (item) { return item.slug === slug; })[0];
    if (!protocol) return;

    appState.activeProtocolSlug = slug;
    persistUrlState();
    detailModal.textContent = '';

    var farmPlanSteps = generateProtocolFarmPlan(protocol);
    detailModal.appendChild(createDomElement('div', { class: 'detail-head' },
      createDomElement('div', null,
        createDomElement('span', { class: 'brand-name', text: 'Rank ' + protocol.rank + ' of ' + radarState.board_size }),
        createDomElement('h2', { id: 'detail-title', text: protocol.name }),
        createDomElement('p', { class: 'sub', text: (protocol.category || 'Other') + ' on ' + (protocol.chains && protocol.chains.length ? protocol.chains.join(', ') : 'mainnet') })
      ),
      createDomElement('button', {
        class: 'close',
        type: 'button',
        'aria-label': 'Close detail dialog',
        text: 'Close',
        onclick: function () { detailModal.close(); }
      })
    ));

    var recomputedValuation = computeImpliedValuation(protocol, radarState.model);
    detailModal.appendChild(createDomElement('section', { class: 'detail-section' },
      createDomElement('h3', { text: 'Valuation Breakdown' }),
      createDomElement('div', { class: 'equation' },
        createDomElement('div', null, createDomElement('span', { text: 'Total Value Locked' }), createDomElement('b', { class: 'num', text: formatCurrency(protocol.tvl_usd) })),
        createDomElement('div', null, createDomElement('span', { text: '7-Day Growth' }), createDomElement('b', { class: 'num', text: formatPercent(protocol.change_7d) })),
        createDomElement('div', null, createDomElement('span', { text: 'Protocol Age' }), createDomElement('b', { class: 'num', text: formatAgeDays(protocol.age_days) })),
        createDomElement('div', null, createDomElement('span', { text: 'Growth Multiplier' }), createDomElement('b', { class: 'num', text: String(protocol.growth_multiplier) })),
        createDomElement('div', null, createDomElement('span', { text: 'Maturity Multiplier' }), createDomElement('b', { class: 'num', text: String(protocol.maturity_multiplier) })),
        createDomElement('div', null, createDomElement('span', { text: 'Implied Valuation' }), createDomElement('b', { class: 'num', text: formatCurrency(protocol.implied_value_usd) }))
      ),
      createDomElement('p', { class: 'sub', text: 'Engine verification: Local client re-evaluation produces ' + formatCurrency(recomputedValuation) + ' (match: ' + (recomputedValuation === protocol.implied_value_usd ? 'deterministic' : 'variance') + ').' })
    ));

    detailModal.appendChild(createDomElement('section', { class: 'detail-section' },
      createDomElement('h3', { text: 'Actionable Farming Guide' }),
      createDomElement('ol', { class: 'steps' }, farmPlanSteps.map(function (stepDesc) {
        var costMarker = stepDesc.indexOf(' Cost: ');
        var actionText = costMarker >= 0 ? stepDesc.slice(0, costMarker) : stepDesc;
        var costAndTime = costMarker >= 0 ? stepDesc.slice(costMarker + 1) : '';
        return createDomElement('li', null,
          createDomElement('b', { text: actionText }),
          createDomElement('span', { class: 'cost', text: costAndTime })
        );
      }))
    ));

    if (typeof detailModal.showModal === 'function') {
      if (!detailModal.open) detailModal.showModal();
    } else {
      detailModal.setAttribute('open', '');
    }
  }

  function renderAppView() {
    rootContainer.textContent = '';
    var mainWrapper = createDomElement('div', { class: 'shell' });
    mainWrapper.appendChild(renderAppHeader());
    mainWrapper.appendChild(renderHeroBanner());
    mainWrapper.appendChild(renderFilterControls());
    mainWrapper.appendChild(appState.activeTab === 'pre-token' ? renderRankingTable() : renderLiveTokenBenchmarkTable());
    if (appState.activeTab === 'pre-token') mainWrapper.appendChild(renderModelDescriptionSection());

    rootContainer.appendChild(mainWrapper);
    rootContainer.setAttribute('aria-busy', 'false');
    if (!detailModal.isConnected) rootContainer.appendChild(detailModal);
    if (appState.activeProtocolSlug) openProtocolDetailModal(appState.activeProtocolSlug);
  }

  synchronizeUrlState();
  renderAppView();
  window.addEventListener('keydown', function (evt) {
    if (evt.key === 'Escape' && detailModal.open) detailModal.close();
  });
})();
