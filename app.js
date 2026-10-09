(function () {
  'use strict';
  const { createApp, ref, computed, watch, nextTick } = Vue;
  const data = window.HW_DATA || {};
  const rawRows = Array.isArray(data.rows) ? data.rows : [];
  const allMonths = Array.from(new Set(rawRows.map(row => String(row.date).slice(0, 7)))).sort();
  const categories = Array.from(new Set(rawRows.map(row => row.category))).sort((a, b) => a.localeCompare(b, 'ru'));
  const monthNames = ['январь','февраль','март','апрель','май','июнь','июль','август','сентябрь','октябрь','ноябрь','декабрь'];
  const monthLabel = key => { const [year, month] = key.split('-'); return monthNames[Number(month) - 1] + ' ' + year; };
  const shiftMonth = (key, offset) => {
    const [year, month] = key.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1 + offset, 1));
    return date.toISOString().slice(0, 7);
  };
  const monthRange = end => Array.from({ length: 24 }, (_, i) => shiftMonth(end, i - 23));
  const money = value => Number(value || 0).toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₽';
  const number = value => Number(value || 0).toLocaleString('ru-RU', { maximumFractionDigits: 1 });
  const percent = value => (Number(value || 0) * 100).toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + '%';
  const safeImage = item => (data.images && data.images[item]) || '';

  const app = createApp({
    setup() {
      const selectedMonth = ref(allMonths.includes('2026-08') ? '2026-08' : allMonths[allMonths.length - 1]);
      const selectedCategory = ref('');
      const productSort = ref('money');
      const detailProduct = ref(null);
      const detailPinned = ref(false);
      const errorMessage = ref('');
      const metricSvgs = {};
      const productSvg = ref(null);
      const sparkSvg = ref(null);
      const detailStyle = ref({});

      const windowMonths = computed(() => monthRange(selectedMonth.value));
      const filteredRows = computed(() => rawRows.filter(row => !selectedCategory.value || row.category === selectedCategory.value));
      const windowRows = computed(() => filteredRows.value.filter(row => windowMonths.value.includes(String(row.date).slice(0, 7))));
      const monthRows = month => filteredRows.value.filter(row => String(row.date).slice(0, 7) === month);
      const aggregate = rows => {
        const base = rows.reduce((sum, row) => sum + Number(row.price || 0) * Number(row.quantity || 0), 0);
        const paid = rows.reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
        return { spending: paid, quantity: rows.reduce((sum, row) => sum + Number(row.quantity || 0), 0), orders: new Set(rows.map(row => row.order)).size, discount: base ? 1 - paid / base : null, base };
      };
      const selectedStats = computed(() => aggregate(monthRows(selectedMonth.value)));
      const previousStats = computed(() => aggregate(monthRows(shiftMonth(selectedMonth.value, -1))));
      const metricSeries = computed(() => {
        const rows = windowMonths.value.map(month => ({ month, ...aggregate(monthRows(month)) }));
        return {
          orders: rows.map(row => ({ month: row.month, value: row.orders })),
          spending: rows.map(row => ({ month: row.month, value: row.spending })),
          discount: rows.map(row => ({ month: row.month, value: row.discount == null ? null : row.discount * 100 }))
        };
      });
      const change = (current, previous, isDiscount) => { if (current == null || previous == null) return 'нет данных'; const delta = isDiscount ? current - previous : previous ? (current - previous) / previous * 100 : null; if (delta == null) return 'нет базы'; return (delta >= 0 ? '+' : '') + (isDiscount ? delta.toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + ' п.п.' : delta.toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + '%') + ' к пред. месяцу'; };
      const metricCards = computed(() => [
        { key: 'orders', label: 'Заказы', unit: 'шт.', display: number(selectedStats.value.orders), changeText: change(selectedStats.value.orders, previousStats.value.orders, false), changeClass: selectedStats.value.orders >= previousStats.value.orders ? 'positive' : 'negative' },
        { key: 'spending', label: 'Расходы', unit: '₽', display: money(selectedStats.value.spending), changeText: change(selectedStats.value.spending, previousStats.value.spending, false), changeClass: selectedStats.value.spending >= previousStats.value.spending ? 'negative' : 'positive' },
        { key: 'discount', label: 'Средняя скидка', unit: 'взвешенная', display: selectedStats.value.discount == null ? '—' : percent(selectedStats.value.discount), changeText: change(selectedStats.value.discount == null ? null : selectedStats.value.discount * 100, previousStats.value.discount == null ? null : previousStats.value.discount * 100, true), changeClass: 'positive' }
      ]);
      const categoryRows = computed(() => {
        const rows = rawRows.filter(row => windowMonths.value.includes(String(row.date).slice(0, 7)));
        const totals = aggregate(rows);
        return categories.map(category => {
          const stats = aggregate(rows.filter(row => row.category === category));
          return { category, ...stats, share: totals.spending ? stats.spending / totals.spending * 100 : 0 };
        }).sort((a, b) => b.spending - a.spending);
      });
      const products = computed(() => {
        const map = new Map();
        windowRows.value.filter(row => row.category !== 'Услуги Груши').forEach(row => { const item = map.get(row.item) || { item: row.item, category: row.category, quantity: 0, spending: 0, base: 0 }; item.quantity += Number(row.quantity || 0); item.spending += Number(row.amount ?? 0); item.base += Number(row.price || 0) * Number(row.quantity || 0); map.set(row.item, item); });
        const sortKey = productSort.value === 'quantity' ? 'quantity' : 'spending';
        return Array.from(map.values()).map(item => ({ ...item, weightedPrice: item.quantity ? item.spending / item.quantity : 0 })).sort((a, b) => b[sortKey] - a[sortKey]).slice(0, 12);
      });
      const registerMetricSvg = (key, el) => { if (el) metricSvgs[key] = el; };
      const drawMetric = (key, series) => {
        const node = metricSvgs[key]; if (!node) return; const svg = d3.select(node); svg.selectAll('*').remove(); const width = 320, height = 76, margin = { top: 8, right: 8, bottom: 20, left: 28 }; svg.attr('viewBox', `0 0 ${width} ${height}`);
        const values = series.map(d => d.value).filter(v => v != null); const max = Math.max(1, d3.max(values) || 1); const x = d3.scalePoint().domain(series.map(d => d.month)).range([margin.left, width - margin.right]); const y = d3.scaleLinear().domain([0, max]).nice().range([height - margin.bottom, margin.top]);
        svg.append('g').attr('class', 'axis').attr('transform', `translate(0,${height - margin.bottom})`).call(d3.axisBottom(x).tickValues([series[0].month, series[11].month, series[23].month]).tickFormat(d => d.slice(2))).call(g => g.select('.domain').attr('stroke', 'transparent'));
        svg.append('g').attr('class', 'axis').attr('transform', `translate(${margin.left},0)`).call(d3.axisLeft(y).ticks(2).tickFormat(v => key === 'discount' ? v + '%' : key === 'spending' ? v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v : v)).call(g => g.select('.domain').attr('stroke', 'transparent'));
        const line = d3.line().defined(d => d.value != null).x(d => x(d.month)).y(d => y(d.value)); svg.append('path').datum(series).attr('class', 'metric-line').attr('d', line); svg.selectAll('.metric-point').data(series.filter(d => d.value != null)).join('circle').attr('class', 'metric-point').attr('cx', d => x(d.month)).attr('cy', d => y(d.value)).attr('r', 2.4).append('title').text(d => monthLabel(d.month) + ': ' + (key === 'discount' ? d.value.toFixed(1) + '%' : key === 'spending' ? money(d.value) : number(d.value) + ' шт.'));
      };
      const drawProducts = () => {
        const node = productSvg.value;
        if (!node) return;
        const svg = d3.select(node); svg.selectAll('*').remove();
        const width = 920, rowHeight = 58;
        const height = Math.max(180, products.value.length * rowHeight + 64);
        const qtyStart = 360, qtyWidth = 170, moneyStart = 630, moneyWidth = 185;
        svg.attr('viewBox', `0 0 ${width} ${height}`);
        const q = d3.scaleLinear().domain([0, d3.max(products.value, d => d.quantity) || 1]).range([0, qtyWidth]);
        const m = d3.scaleLinear().domain([0, d3.max(products.value, d => d.spending) || 1]).range([0, moneyWidth]);
        svg.append('text').attr('class', 'chart-heading').attr('x', qtyStart).attr('y', 14).text('КОЛИЧЕСТВО, ШТ.');
        svg.append('text').attr('class', 'chart-heading').attr('x', moneyStart).attr('y', 14).text('РАСХОДЫ, ₽');
        svg.append('g').attr('class', 'chart-axis').attr('transform', `translate(${qtyStart},34)`)
          .call(d3.axisTop(q).ticks(3).tickFormat(number));
        svg.append('g').attr('class', 'chart-axis').attr('transform', `translate(${moneyStart},34)`)
          .call(d3.axisTop(m).ticks(3).tickFormat(v => v >= 1000 ? number(v / 1000) + ' тыс.' : number(v)));
        const rows = svg.selectAll('.product-row').data(products.value, d => d.item).join('g')
          .attr('class', 'product-row').attr('transform', (d, i) => `translate(0,${52 + i * rowHeight})`)
          .attr('tabindex', 0).attr('role', 'button')
          .attr('aria-label', d => `${d.item}, ${number(d.quantity)} шт., ${money(d.spending)}. Показать динамику цены`)
          .on('mouseenter focus', (event, d) => { if (!detailPinned.value) showDetail(d, false, event); })
          .on('click', (event, d) => showDetail(d, true, event))
          .on('keydown', (event, d) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); showDetail(d, true, event); } });
        rows.append('rect').attr('x', 0).attr('y', 0).attr('width', width).attr('height', rowHeight - 2).attr('fill', 'transparent');
        rows.append('line').attr('x1', 0).attr('x2', width).attr('y1', rowHeight - 5).attr('y2', rowHeight - 5).attr('stroke', '#ebe6dc');
        rows.append('rect').attr('x', 0).attr('y', 4).attr('width', 40).attr('height', 40).attr('rx', 5).attr('fill', '#fff');
        rows.append('image').attr('href', d => imageFor(d.item)).attr('x', 2).attr('y', 6).attr('width', 36).attr('height', 36).attr('preserveAspectRatio', 'xMidYMid meet');
        rows.append('text').attr('class', 'product-name').attr('x', 52).attr('y', 19)
          .each(function(d) {
            const text = d3.select(this), words = d.item.split(/\s+/); let line = [], lineNumber = 0;
            let span = text.append('tspan').attr('x', 52).attr('dy', 0);
            for (const word of words) {
              line.push(word); span.text(line.join(' '));
              if (span.node().getComputedTextLength() > 292 && line.length > 1) {
                line.pop(); span.text(line.join(' ')); line = [word];
                span = text.append('tspan').attr('x', 52).attr('dy', 14).text(word); lineNumber++;
              }
            }
          });
        rows.append('rect').attr('class', 'bar-track').attr('x', qtyStart).attr('y', 16).attr('width', qtyWidth).attr('height', 15).attr('rx', 3);
        rows.append('rect').attr('class', 'bar quantity-bar').attr('x', qtyStart).attr('y', 16).attr('width', d => q(d.quantity)).attr('height', 15).attr('rx', 3);
        rows.append('text').attr('class', 'bar-value').attr('x', qtyStart + qtyWidth + 10).attr('y', 28).text(d => number(d.quantity));
        rows.append('rect').attr('class', 'bar-track').attr('x', moneyStart).attr('y', 16).attr('width', moneyWidth).attr('height', 15).attr('rx', 3);
        rows.append('rect').attr('class', 'bar money-bar').attr('x', moneyStart).attr('y', 16).attr('width', d => m(d.spending)).attr('height', 15).attr('rx', 3);
        rows.append('text').attr('class', 'bar-value').attr('x', moneyStart + moneyWidth + 10).attr('y', 28).text(d => money(d.spending));
      };
      const drawSparkline = () => { const node = sparkSvg.value; if (!node || !detailProduct.value) return; const item = detailProduct.value.item; const series = windowMonths.value.map(month => { const rows = filteredRows.value.filter(row => row.item === item && String(row.date).slice(0, 7) === month); const qty = d3.sum(rows, d => Number(d.quantity || 0)); return { month, value: qty ? d3.sum(rows, d => Number(d.amount ?? 0)) / qty : null }; }); const svg = d3.select(node); svg.selectAll('*').remove(); const width = 580, height = 102, margin = { top: 14, right: 18, bottom: 25, left: 42 }; svg.attr('viewBox', `0 0 ${width} ${height}`); const vals = series.filter(d => d.value != null).map(d => d.value); const x = d3.scalePoint().domain(windowMonths.value).range([margin.left, width - margin.right]); const y = d3.scaleLinear().domain([0, d3.max(vals) || 1]).nice().range([height - margin.bottom, margin.top]); svg.append('g').attr('class', 'axis').attr('transform', `translate(0,${height - margin.bottom})`).call(d3.axisBottom(x).tickValues([windowMonths.value[0], windowMonths.value[11], windowMonths.value[23]]).tickFormat(d => d.slice(2))); svg.append('g').attr('class', 'axis').attr('transform', `translate(${margin.left},0)`).call(d3.axisLeft(y).ticks(2).tickFormat(v => Math.round(v) + ' ₽')); svg.append('path').datum(series).attr('class', 'spark-line').attr('d', d3.line().defined(d => d.value != null).x(d => x(d.month)).y(d => y(d.value))); svg.selectAll('circle').data(series.filter(d => d.value != null)).join('circle').attr('class', 'spark-point').attr('cx', d => x(d.month)).attr('cy', d => y(d.value)).attr('r', 2.7).append('title').text(d => monthLabel(d.month) + ': ' + money(d.value)); };
      const showDetail = (product, pinned, event) => {
        detailProduct.value = product; detailPinned.value = pinned;
        const width = Math.min(470, window.innerWidth - 24);
        const rect = event?.currentTarget?.getBoundingClientRect();
        const x = event?.clientX ?? rect?.right ?? window.innerWidth / 2;
        const y = event?.clientY ?? rect?.top ?? 150;
        const left = Math.max(12, Math.min(window.innerWidth - width - 12, x + 18));
        detailStyle.value = { left: left + 'px', top: Math.max(12, Math.min(window.innerHeight - 315, y - 80)) + 'px', width: width + 'px' };
        nextTick(drawSparkline);
      };
      const closeDetail = () => { detailProduct.value = null; detailPinned.value = false; };
      const resetFilters = () => { selectedMonth.value = allMonths.includes('2026-08') ? '2026-08' : allMonths[allMonths.length - 1]; selectedCategory.value = ''; productSort.value = 'money'; closeDetail(); };
      const toggleCategory = category => { selectedCategory.value = selectedCategory.value === category ? '' : category; };
      const imageFor = safeImage;
      const hideBrokenImage = event => { event.target.style.display = 'none'; };
      const render = () => { metricCards.value.forEach(metric => drawMetric(metric.key, metricSeries.value[metric.key])); drawProducts(); nextTick(drawSparkline); };
      watch([selectedMonth, selectedCategory, productSort], () => { closeDetail(); nextTick(render); }); watch(detailProduct, () => nextTick(drawSparkline));
      document.addEventListener('pointermove', event => { if (!detailPinned.value && detailProduct.value && !event.target.closest('.products-panel')) closeDetail(); });
      window.addEventListener('keydown', event => { if (event.key === 'Escape') closeDetail(); });
      document.addEventListener('click', event => { if (detailProduct.value && !event.target.closest('.detail-card') && !event.target.closest('.product-row')) closeDetail(); });
      nextTick(render);
      window.dashboardTest = { state: { selectedMonth, selectedCategory, productSort, metricCards, categoryRows, products, windowMonths, metricSeries, previousStats }, setMonth: month => { selectedMonth.value = month; }, setCategory: category => { selectedCategory.value = category || ''; }, reset: resetFilters, getTotals: () => ({ month: selectedMonth.value, category: selectedCategory.value, ...selectedStats.value }) };
      return { windowStart: computed(() => windowMonths.value[0]), months: allMonths, categories, selectedMonth, selectedCategory, productSort, metricCards, categoryRows, products, detailProduct, detailPinned, detailStyle, errorMessage, productSvg, sparkSvg, monthLabel, resetFilters, toggleCategory, closeDetail, imageFor, hideBrokenImage, fmtMoney: money, fmtNumber: number, fmtPercent: percent, registerMetricSvg, totalCategorySpend: computed(() => d3.sum(categoryRows.value, d => d.spending)) };
    },
    mounted() { if (!rawRows.length) this.errorMessage = 'В data.js не найдены строки заказов.'; }
  });
  try { app.mount('#app'); } catch (error) { const root = document.getElementById('app'); if (root) root.textContent = 'Ошибка загрузки: ' + error.message; }
}());
