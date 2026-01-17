let data = {
    before: null,
    after: null
};

let processedData = {
    before: null,
    after: null
};

let charts = {};

function loadFile(input, type) {
    const file = input.files[0];
    if (!file) return;

    const statusEl = document.getElementById(`status-${type}`);
    statusEl.textContent = 'Cargando...';

    const reader = new FileReader();
    reader.onload = function (e) {
        try {
            data[type] = JSON.parse(e.target.result);
            processedData[type] = processProfilerData(data[type]);

            const loader = input.closest('.file-loader');
            loader.classList.add('loaded');
            statusEl.textContent = `Cargado: ${file.name}`;

            updateUI();
        } catch (error) {
            statusEl.textContent = 'Error al parsear JSON';
            console.error(error);
        }
    };
    reader.readAsText(file);
}

function processProfilerData(rawData) {
    const root = rawData.dataForRoots[0];
    const timeline = rawData.timelineData?.[0];

    // Crear mapa de snapshots (id -> info del componente)
    const snapshotMap = new Map();
    for (const [id, info] of root.snapshots) {
        snapshotMap.set(id, info);
    }

    // Construir mapa de padres (child_id -> parent_id) para jerarquía
    const parentMap = new Map();
    for (const [id, info] of root.snapshots) {
        if (info.children) {
            for (const childId of info.children) {
                parentMap.set(childId, id);
            }
        }
    }

    // Función para obtener el path completo de un componente
    function getComponentPath(componentId, maxDepth = 15) {
        const path = [];
        let current = componentId;
        let depth = 0;
        while (current && depth < maxDepth) {
            const info = snapshotMap.get(current);
            if (info && info.displayName) {
                path.push(info.displayName);
            }
            current = parentMap.get(current);
            depth++;
        }
        return path.reverse();
    }

    // Mapa de nombre -> paths (un componente puede aparecer en varios lugares)
    const componentPaths = new Map();
    for (const [id, info] of root.snapshots) {
        if (info.displayName) {
            const path = getComponentPath(id);
            if (path.length > 1) {
                if (!componentPaths.has(info.displayName)) {
                    componentPaths.set(info.displayName, []);
                }
                const pathStr = path.join(' > ');
                const paths = componentPaths.get(info.displayName);
                if (!paths.includes(pathStr)) {
                    paths.push(pathStr);
                }
            }
        }
    }

    // Procesar component measures para conteo de renders
    const componentStats = new Map();

    if (timeline?.componentMeasures) {
        for (const measure of timeline.componentMeasures) {
            const name = measure.componentName;
            if (!componentStats.has(name)) {
                componentStats.set(name, {
                    name,
                    renderCount: 0,
                    totalDuration: 0,
                    mounts: 0,
                    updates: 0
                });
            }
            const stats = componentStats.get(name);
            stats.renderCount++;
            stats.totalDuration += measure.duration;
            if (measure.type === 'render') {
                stats.updates++;
            }
        }
    }

    // Procesar causas de re-render desde commitData
    const rerenderCauses = new Map();
    const globalCauses = {
        hooks: 0,
        props: 0,
        state: 0,
        context: 0,
        mount: 0
    };

    for (const commit of root.commitData) {
        if (!commit.changeDescriptions) continue;

        for (const [fiberId, desc] of commit.changeDescriptions) {
            const snapshot = snapshotMap.get(fiberId);
            const name = snapshot?.displayName || `Component#${fiberId}`;

            if (!rerenderCauses.has(name)) {
                rerenderCauses.set(name, {
                    name,
                    causes: { hooks: 0, props: 0, state: 0, context: 0, mount: 0 },
                    totalRerenders: 0
                });
            }

            const causeData = rerenderCauses.get(name);
            causeData.totalRerenders++;

            if (desc.isFirstMount) {
                causeData.causes.mount++;
                globalCauses.mount++;
            } else {
                if (desc.didHooksChange) {
                    causeData.causes.hooks++;
                    globalCauses.hooks++;
                }
                if (desc.props && desc.props.length > 0) {
                    causeData.causes.props++;
                    globalCauses.props++;
                }
                if (desc.state !== null && desc.state !== undefined) {
                    causeData.causes.state++;
                    globalCauses.state++;
                }
                if (desc.context) {
                    causeData.causes.context++;
                    globalCauses.context++;
                }
            }
        }
    }

    // Commits info
    const commits = root.commitData.map((c, i) => ({
        index: i,
        duration: c.duration,
        effectDuration: c.effectDuration,
        timestamp: c.timestamp
    }));

    // Scheduling events
    const schedulingEvents = timeline?.schedulingEvents || [];

    return {
        snapshotMap,
        componentStats: Array.from(componentStats.values()),
        rerenderCauses: Array.from(rerenderCauses.values()),
        globalCauses,
        commits,
        schedulingEvents,
        componentPaths,
        totalDuration: timeline?.duration || commits.reduce((sum, c) => sum + c.duration, 0),
        totalCommits: commits.length,
        totalRenders: timeline?.componentMeasures?.length || 0
    };
}

function updateUI() {
    const hasData = processedData.before || processedData.after;
    const hasBoth = processedData.before && processedData.after;

    // Overview
    document.getElementById('overview-empty').style.display = hasData ? 'none' : 'block';
    document.getElementById('overview-content').style.display = hasData ? 'block' : 'none';

    // Components
    document.getElementById('components-empty').style.display = hasData ? 'none' : 'block';
    document.getElementById('components-content').style.display = hasData ? 'block' : 'none';

    // Rerenders
    document.getElementById('rerenders-empty').style.display = hasData ? 'none' : 'block';
    document.getElementById('rerenders-content').style.display = hasData ? 'block' : 'none';

    // Timeline
    document.getElementById('timeline-empty').style.display = hasData ? 'none' : 'block';
    document.getElementById('timeline-content').style.display = hasData ? 'block' : 'none';

    // Comparison
    document.getElementById('comparison-empty').style.display = hasBoth ? 'none' : 'block';
    document.getElementById('comparison-content').style.display = hasBoth ? 'block' : 'none';

    if (hasData) {
        renderOverview();
        renderComponents();
        renderRerenders();
        renderTimeline();
    }

    if (hasBoth) {
        renderComparison();
    }
}

function renderOverview() {
    const current = processedData.after || processedData.before;
    const other = processedData.after ? processedData.before : null;

    const grid = document.getElementById('summary-grid');

    const metrics = [
        {
            label: 'Total Commits',
            value: current.totalCommits,
            compare: other?.totalCommits
        },
        {
            label: 'Total Renders',
            value: current.totalRenders,
            compare: other?.totalRenders
        },
        {
            label: 'Duracion Total',
            value: `${current.totalDuration.toFixed(1)}ms`,
            compare: other ? `${other.totalDuration.toFixed(1)}ms` : null,
            numCompare: other?.totalDuration
        },
        {
            label: 'Componentes Unicos',
            value: current.componentStats.length,
            compare: other?.componentStats.length
        },
        {
            label: 'Avg Commit Duration',
            value: `${(current.totalDuration / current.totalCommits).toFixed(2)}ms`,
            numCompare: other ? (other.totalDuration / other.totalCommits) : null
        }
    ];

    grid.innerHTML = metrics.map(m => {
        let comparisonHtml = '';
        if (m.compare !== undefined && m.compare !== null) {
            const currentNum = m.numCompare !== undefined ?
                (typeof m.value === 'string' ? parseFloat(m.value) : m.value) :
                (typeof m.value === 'string' ? parseFloat(m.value) : m.value);
            const otherNum = m.numCompare !== undefined ? m.numCompare :
                (typeof m.compare === 'string' ? parseFloat(m.compare) : m.compare);

            if (!isNaN(currentNum) && !isNaN(otherNum) && otherNum !== 0) {
                const diff = ((currentNum - otherNum) / otherNum * 100).toFixed(1);
                const isBetter = currentNum < otherNum;
                comparisonHtml = `<div class="comparison ${isBetter ? 'better' : 'worse'}">
                    ${isBetter ? '↓' : '↑'} ${Math.abs(diff)}% vs anterior
                </div>`;
            }
        }

        return `
            <div class="summary-card">
                <h4>${m.label}</h4>
                <div class="value">${m.value}</div>
                ${comparisonHtml}
            </div>
        `;
    }).join('');

    // Commit duration chart
    renderCommitDurationChart(current);

    // Rerender reasons chart
    renderRerenderReasonsChart(current);
}

function renderCommitDurationChart(data) {
    const ctx = document.getElementById('commitDurationChart').getContext('2d');

    if (charts.commitDuration) {
        charts.commitDuration.destroy();
    }

    charts.commitDuration = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: data.commits.map((_, i) => `#${i + 1}`),
            datasets: [{
                label: 'Duracion (ms)',
                data: data.commits.map(c => c.duration),
                backgroundColor: 'rgba(88, 166, 255, 0.7)',
                borderColor: 'rgba(88, 166, 255, 1)',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: 'rgba(255,255,255,0.1)' },
                    ticks: { color: '#8b949e' }
                },
                x: {
                    grid: { display: false },
                    ticks: {
                        color: '#8b949e',
                        maxTicksLimit: 20
                    }
                }
            }
        }
    });
}

function renderRerenderReasonsChart(data) {
    const ctx = document.getElementById('rerenderReasonsChart').getContext('2d');

    if (charts.rerenderReasons) {
        charts.rerenderReasons.destroy();
    }

    const causes = data.globalCauses;

    charts.rerenderReasons = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Hooks', 'Props', 'State', 'Context', 'Mount'],
            datasets: [{
                data: [causes.hooks, causes.props, causes.state, causes.context, causes.mount],
                backgroundColor: [
                    'rgba(88, 166, 255, 0.8)',
                    'rgba(163, 113, 247, 0.8)',
                    'rgba(210, 153, 34, 0.8)',
                    'rgba(248, 81, 73, 0.8)',
                    'rgba(63, 185, 80, 0.8)'
                ],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'right',
                    labels: { color: '#e6edf3' }
                }
            }
        }
    });
}

function renderComponents() {
    const before = processedData.before;
    const after = processedData.after;
    const hasBoth = before && after;

    const filter = document.getElementById('component-filter')?.value?.toLowerCase() || '';
    const sort = document.getElementById('component-sort')?.value || 'renders';

    // Merge components from both datasets
    const beforeMap = new Map((before?.componentStats || []).map(c => [c.name, c]));
    const afterMap = new Map((after?.componentStats || []).map(c => [c.name, c]));
    const allNames = new Set([...beforeMap.keys(), ...afterMap.keys()]);

    let components = Array.from(allNames).map(name => {
        const b = beforeMap.get(name) || { renderCount: 0, totalDuration: 0 };
        const a = afterMap.get(name) || { renderCount: 0, totalDuration: 0 };
        return {
            name,
            beforeRenders: b.renderCount,
            beforeDuration: b.totalDuration,
            afterRenders: a.renderCount,
            afterDuration: a.totalDuration,
            diff: a.renderCount - b.renderCount,
            maxRenders: Math.max(b.renderCount, a.renderCount),
            maxDuration: Math.max(b.totalDuration, a.totalDuration)
        };
    });

    // Filter
    if (filter) {
        components = components.filter(c => c.name.toLowerCase().includes(filter));
    }

    // Sort
    components.sort((a, b) => {
        if (sort === 'renders') return b.maxRenders - a.maxRenders;
        if (sort === 'duration') return b.maxDuration - a.maxDuration;
        if (sort === 'improvement') return a.diff - b.diff;
        return a.name.localeCompare(b.name);
    });

    const globalMaxRenders = Math.max(...components.map(c => c.maxRenders), 1);
    const globalMaxDuration = Math.max(...components.map(c => c.maxDuration), 1);

    // Merge paths from both datasets
    const allPaths = new Map();
    if (before?.componentPaths) {
        for (const [name, paths] of before.componentPaths) {
            if (!allPaths.has(name)) allPaths.set(name, new Set());
            paths.forEach(p => allPaths.get(name).add(p));
        }
    }
    if (after?.componentPaths) {
        for (const [name, paths] of after.componentPaths) {
            if (!allPaths.has(name)) allPaths.set(name, new Set());
            paths.forEach(p => allPaths.get(name).add(p));
        }
    }

    document.getElementById('component-count').textContent = `${components.length} componentes`;

    const list = document.getElementById('components-list');

    function getPathsHtml(name) {
        const paths = allPaths.get(name);
        if (!paths || paths.size === 0) return '';
        const pathsArray = Array.from(paths).slice(0, 5); // Limitar a 5 paths
        return `
            <div class="component-paths" id="paths-${escapeAttr(name)}" style="display: none;">
                <div class="paths-header">Ubicaciones en el arbol:</div>
                ${pathsArray.map(p => `<div class="path-item">${escapeHtml(p)}</div>`).join('')}
                ${paths.size > 5 ? `<div class="paths-more">...y ${paths.size - 5} mas</div>` : ''}
            </div>
        `;
    }

    if (hasBoth) {
        list.innerHTML = `
            <div class="component-row-compare header-row">
                <div>Componente</div>
                <div class="dual-column">
                    <span class="label-before">Sin Optimizar</span>
                    <span class="label-after">Optimizado</span>
                </div>
                <div>Diferencia</div>
            </div>
            ${components.slice(0, 100).map(c => {
                const diffClass = c.diff < 0 ? 'diff-positive' : c.diff > 0 ? 'diff-negative' : '';
                const diffPercent = c.beforeRenders > 0
                    ? ((c.diff / c.beforeRenders) * 100).toFixed(0)
                    : (c.afterRenders > 0 ? '+100' : '0');
                const hasPaths = allPaths.has(c.name) && allPaths.get(c.name).size > 0;
                return `
                <div class="component-row-compare">
                    <div class="component-name-wrapper">
                        <div class="component-name ${hasPaths ? 'clickable' : ''}" ${hasPaths ? `onclick="togglePaths('${escapeAttr(c.name)}')"` : ''}>
                            ${hasPaths ? '<span class="expand-icon">▶</span>' : ''}
                            ${escapeHtml(c.name)}
                        </div>
                        ${getPathsHtml(c.name)}
                    </div>
                    <div class="dual-column">
                        <div class="stat-cell before">
                            <div class="bar-container">
                                <div class="bar renders-before" style="width: ${(c.beforeRenders / globalMaxRenders * 100)}%"></div>
                            </div>
                            <span class="stat-value">${c.beforeRenders} <small>(${c.beforeDuration.toFixed(1)}ms)</small></span>
                        </div>
                        <div class="stat-cell after">
                            <div class="bar-container">
                                <div class="bar renders-after" style="width: ${(c.afterRenders / globalMaxRenders * 100)}%"></div>
                            </div>
                            <span class="stat-value">${c.afterRenders} <small>(${c.afterDuration.toFixed(1)}ms)</small></span>
                        </div>
                    </div>
                    <div class="stat-value ${diffClass}">
                        ${c.diff > 0 ? '+' : ''}${c.diff}
                        <small>(${c.diff > 0 ? '+' : ''}${diffPercent}%)</small>
                    </div>
                </div>
            `}).join('')}
        `;
    } else {
        // Single dataset view (fallback)
        const data = after || before;
        const dataComponents = data.componentStats.filter(c =>
            !filter || c.name.toLowerCase().includes(filter)
        );

        dataComponents.sort((a, b) => {
            if (sort === 'renders') return b.renderCount - a.renderCount;
            if (sort === 'duration') return b.totalDuration - a.totalDuration;
            return a.name.localeCompare(b.name);
        });

        const maxRenders = Math.max(...dataComponents.map(c => c.renderCount), 1);

        list.innerHTML = `
            <div class="component-row-single header-row">
                <div>Componente</div>
                <div>Renders</div>
                <div>Duracion</div>
            </div>
            ${dataComponents.slice(0, 100).map(c => {
                const hasPaths = allPaths.has(c.name) && allPaths.get(c.name).size > 0;
                return `
                <div class="component-row-single">
                    <div class="component-name-wrapper">
                        <div class="component-name ${hasPaths ? 'clickable' : ''}" ${hasPaths ? `onclick="togglePaths('${escapeAttr(c.name)}')"` : ''}>
                            ${hasPaths ? '<span class="expand-icon">▶</span>' : ''}
                            ${escapeHtml(c.name)}
                        </div>
                        ${getPathsHtml(c.name)}
                    </div>
                    <div>
                        <div class="bar-container">
                            <div class="bar renders" style="width: ${(c.renderCount / maxRenders * 100)}%"></div>
                        </div>
                        <span class="stat-value">${c.renderCount}</span>
                    </div>
                    <div class="stat-value">${c.totalDuration.toFixed(1)}ms</div>
                </div>
            `}).join('')}
        `;
    }
}

function filterComponents() {
    renderComponents();
}

function sortComponents() {
    renderComponents();
}

function renderRerenders() {
    const before = processedData.before;
    const after = processedData.after;
    const hasBoth = before && after;

    const filter = document.getElementById('rerender-filter')?.value?.toLowerCase() || '';

    // Merge rerenders from both datasets
    const beforeMap = new Map((before?.rerenderCauses || []).map(c => [c.name, c]));
    const afterMap = new Map((after?.rerenderCauses || []).map(c => [c.name, c]));
    const allNames = new Set([...beforeMap.keys(), ...afterMap.keys()]);

    let components = Array.from(allNames).map(name => {
        const b = beforeMap.get(name) || { totalRerenders: 0, causes: { hooks: 0, props: 0, state: 0, context: 0, mount: 0 } };
        const a = afterMap.get(name) || { totalRerenders: 0, causes: { hooks: 0, props: 0, state: 0, context: 0, mount: 0 } };
        return {
            name,
            before: b,
            after: a,
            diff: a.totalRerenders - b.totalRerenders,
            maxRerenders: Math.max(b.totalRerenders, a.totalRerenders)
        };
    });

    // Filter
    if (filter) {
        components = components.filter(c => c.name.toLowerCase().includes(filter));
    }

    // Sort by max rerenders
    components.sort((a, b) => b.maxRerenders - a.maxRerenders);

    const list = document.getElementById('rerenders-list');

    function renderBadges(causes) {
        let html = '';
        if (causes.hooks > 0) html += `<span class="reason-badge hooks">Hooks: ${causes.hooks}</span>`;
        if (causes.props > 0) html += `<span class="reason-badge props">Props: ${causes.props}</span>`;
        if (causes.state > 0) html += `<span class="reason-badge state">State: ${causes.state}</span>`;
        if (causes.context > 0) html += `<span class="reason-badge context">Context: ${causes.context}</span>`;
        if (causes.mount > 0) html += `<span class="reason-badge mount">Mount: ${causes.mount}</span>`;
        return html || '<span class="no-rerenders">-</span>';
    }

    if (hasBoth) {
        list.innerHTML = `
            <div class="rerender-row-compare header-row">
                <div>Componente</div>
                <div class="rerender-dual">
                    <span class="label-before">Sin Optimizar</span>
                    <span class="label-after">Optimizado</span>
                </div>
                <div>Diff</div>
            </div>
            ${components.slice(0, 100).map(c => {
                const diffClass = c.diff < 0 ? 'diff-positive' : c.diff > 0 ? 'diff-negative' : '';
                return `
                <div class="rerender-row-compare">
                    <div class="component-name">${escapeHtml(c.name)}</div>
                    <div class="rerender-dual">
                        <div class="rerender-cell before">
                            <div class="rerender-count">${c.before.totalRerenders}</div>
                            <div class="rerender-badges">${renderBadges(c.before.causes)}</div>
                        </div>
                        <div class="rerender-cell after">
                            <div class="rerender-count">${c.after.totalRerenders}</div>
                            <div class="rerender-badges">${renderBadges(c.after.causes)}</div>
                        </div>
                    </div>
                    <div class="stat-value ${diffClass}">
                        ${c.diff > 0 ? '+' : ''}${c.diff}
                    </div>
                </div>
            `}).join('')}
        `;
    } else {
        // Single dataset fallback
        const data = after || before;
        let singleComponents = [...data.rerenderCauses];

        if (filter) {
            singleComponents = singleComponents.filter(c => c.name.toLowerCase().includes(filter));
        }
        singleComponents.sort((a, b) => b.totalRerenders - a.totalRerenders);

        list.innerHTML = singleComponents.slice(0, 100).map(c => `
            <div class="component-row" style="grid-template-columns: 1fr auto;">
                <div>
                    <div class="component-name">${escapeHtml(c.name)}</div>
                    <div style="margin-top: 8px;">
                        ${renderBadges(c.causes)}
                    </div>
                </div>
                <div class="stat-value" style="font-size: 1.2rem;">${c.totalRerenders}</div>
            </div>
        `).join('');
    }
}

function filterRerenders() {
    renderRerenders();
}

function renderTimeline() {
    const ctx = document.getElementById('timelineChart').getContext('2d');

    if (charts.timeline) {
        charts.timeline.destroy();
    }

    const datasets = [];

    if (processedData.before) {
        datasets.push({
            label: 'Sin Optimizar',
            data: processedData.before.commits.map(c => ({ x: c.timestamp, y: c.duration })),
            borderColor: 'rgba(248, 81, 73, 1)',
            backgroundColor: 'rgba(248, 81, 73, 0.1)',
            fill: true,
            tension: 0.2
        });
    }

    if (processedData.after) {
        datasets.push({
            label: 'Optimizado',
            data: processedData.after.commits.map(c => ({ x: c.timestamp, y: c.duration })),
            borderColor: 'rgba(63, 185, 80, 1)',
            backgroundColor: 'rgba(63, 185, 80, 0.1)',
            fill: true,
            tension: 0.2
        });
    }

    charts.timeline = new Chart(ctx, {
        type: 'line',
        data: { datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                legend: {
                    labels: { color: '#e6edf3' }
                }
            },
            scales: {
                x: {
                    type: 'linear',
                    title: {
                        display: true,
                        text: 'Timestamp (ms)',
                        color: '#8b949e'
                    },
                    grid: { color: 'rgba(255,255,255,0.1)' },
                    ticks: { color: '#8b949e' }
                },
                y: {
                    title: {
                        display: true,
                        text: 'Duracion (ms)',
                        color: '#8b949e'
                    },
                    grid: { color: 'rgba(255,255,255,0.1)' },
                    ticks: { color: '#8b949e' }
                }
            }
        }
    });

    // Scheduling events
    const current = processedData.after || processedData.before;
    const eventsByComponent = new Map();

    for (const event of current.schedulingEvents.slice(0, 500)) {
        const name = event.componentName || 'Unknown';
        if (!eventsByComponent.has(name)) {
            eventsByComponent.set(name, 0);
        }
        eventsByComponent.set(name, eventsByComponent.get(name) + 1);
    }

    const sortedEvents = Array.from(eventsByComponent.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20);

    document.getElementById('scheduling-events').innerHTML = `
        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px;">
            ${sortedEvents.map(([name, count]) => `
                <div style="padding: 10px; background: var(--bg-tertiary); border-radius: 8px;">
                    <div class="component-name" style="font-size: 0.8rem;">${escapeHtml(name)}</div>
                    <div style="font-size: 1.2rem; font-weight: bold; margin-top: 5px;">${count} events</div>
                </div>
            `).join('')}
        </div>
    `;
}

function renderComparison() {
    const before = processedData.before;
    const after = processedData.after;

    // Summary cards
    const summaryGrid = document.getElementById('comparison-summary');

    const totalRendersDiff = ((after.totalRenders - before.totalRenders) / before.totalRenders * 100).toFixed(1);
    const durationDiff = ((after.totalDuration - before.totalDuration) / before.totalDuration * 100).toFixed(1);
    const commitsDiff = ((after.totalCommits - before.totalCommits) / before.totalCommits * 100).toFixed(1);

    summaryGrid.innerHTML = `
        <div class="summary-card">
            <h4>Reduccion de Renders</h4>
            <div class="value ${parseFloat(totalRendersDiff) < 0 ? 'diff-positive' : 'diff-negative'}">
                ${totalRendersDiff}%
            </div>
            <div class="comparison">${before.totalRenders} -> ${after.totalRenders}</div>
        </div>
        <div class="summary-card">
            <h4>Cambio en Duracion</h4>
            <div class="value ${parseFloat(durationDiff) < 0 ? 'diff-positive' : 'diff-negative'}">
                ${durationDiff}%
            </div>
            <div class="comparison">${before.totalDuration.toFixed(1)}ms -> ${after.totalDuration.toFixed(1)}ms</div>
        </div>
        <div class="summary-card">
            <h4>Cambio en Commits</h4>
            <div class="value ${parseFloat(commitsDiff) < 0 ? 'diff-positive' : 'diff-negative'}">
                ${commitsDiff}%
            </div>
            <div class="comparison">${before.totalCommits} -> ${after.totalCommits}</div>
        </div>
        <div class="summary-card">
            <h4>Renders Evitados</h4>
            <div class="value diff-positive">
                ${Math.max(0, before.totalRenders - after.totalRenders)}
            </div>
            <div class="comparison">menos renderizados</div>
        </div>
    `;

    // Comparison table
    const beforeMap = new Map(before.componentStats.map(c => [c.name, c]));
    const afterMap = new Map(after.componentStats.map(c => [c.name, c]));

    const allComponents = new Set([...beforeMap.keys(), ...afterMap.keys()]);

    const comparisons = Array.from(allComponents).map(name => {
        const b = beforeMap.get(name) || { renderCount: 0, totalDuration: 0 };
        const a = afterMap.get(name) || { renderCount: 0, totalDuration: 0 };

        return {
            name,
            beforeRenders: b.renderCount,
            afterRenders: a.renderCount,
            diff: a.renderCount - b.renderCount,
            percentChange: b.renderCount > 0 ?
                ((a.renderCount - b.renderCount) / b.renderCount * 100) :
                (a.renderCount > 0 ? 100 : 0)
        };
    });

    // Sort by biggest improvement first
    comparisons.sort((a, b) => a.diff - b.diff);

    const tableBody = document.getElementById('comparison-table-body');
    tableBody.innerHTML = comparisons.slice(0, 100).map(c => `
        <tr>
            <td class="component-name">${escapeHtml(c.name)}</td>
            <td>${c.beforeRenders}</td>
            <td>${c.afterRenders}</td>
            <td class="${c.diff < 0 ? 'diff-positive' : c.diff > 0 ? 'diff-negative' : ''}">
                ${c.diff > 0 ? '+' : ''}${c.diff}
            </td>
            <td class="${c.percentChange < 0 ? 'diff-positive' : c.percentChange > 0 ? 'diff-negative' : ''}">
                ${c.percentChange > 0 ? '+' : ''}${c.percentChange.toFixed(1)}%
            </td>
        </tr>
    `).join('');
}

function switchTab(tabId) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.content').forEach(c => c.classList.remove('active'));

    document.querySelector(`.tab[onclick="switchTab('${tabId}')"]`).classList.add('active');
    document.getElementById(tabId).classList.add('active');
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function escapeAttr(text) {
    return text.replace(/'/g, "\\'").replace(/"/g, '\\"');
}

function togglePaths(componentName) {
    const pathsEl = document.getElementById(`paths-${componentName}`);
    if (!pathsEl) return;

    const isVisible = pathsEl.style.display !== 'none';
    pathsEl.style.display = isVisible ? 'none' : 'block';

    // Toggle icon
    const row = pathsEl.closest('.component-row-compare, .component-row-single');
    if (row) {
        const icon = row.querySelector('.expand-icon');
        if (icon) {
            icon.textContent = isVisible ? '▶' : '▼';
        }
    }
}

// Initialize drag and drop on DOM ready
document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('.file-loader').forEach(loader => {
        loader.addEventListener('dragover', e => {
            e.preventDefault();
            loader.style.borderColor = 'var(--accent-blue)';
        });

        loader.addEventListener('dragleave', e => {
            loader.style.borderColor = '';
        });

        loader.addEventListener('drop', e => {
            e.preventDefault();
            loader.style.borderColor = '';
            const file = e.dataTransfer.files[0];
            if (file) {
                const input = loader.querySelector('input');
                const dataTransfer = new DataTransfer();
                dataTransfer.items.add(file);
                input.files = dataTransfer.files;
                input.dispatchEvent(new Event('change'));
            }
        });
    });
});
