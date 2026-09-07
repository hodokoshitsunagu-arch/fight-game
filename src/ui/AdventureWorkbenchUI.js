import { AdventureWorkbench } from '../campaign/v3/AdventureWorkbench.js';
import { AuthorDraftAssistant } from '../campaign/v3/AuthorDraftAssistant.js';

const SECTIONS = [
  ['cases', '案件'],
  ['graph.nodes', '锚点、互动、文化状态与回退'],
  ['graph.edges', '剧情边'],
  ['evidence', '证据'],
  ['sources', '史实来源'],
  ['endings', '结局'],
  ['participantRules', '多人规则'],
];

function atPath(target, path) {
  return path.split('.').reduce((value, key) => value?.[key], target);
}

async function requestDraft(payload) {
  const response = await fetch('/api/adventure-drafts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? 'draft-request-failed');
  return result;
}

export class AdventureWorkbenchUI {
  constructor({ adventurePackage, streetView, playtest, parent = document.body }) {
    this.workbench = new AdventureWorkbench(adventurePackage, { streetView });
    this.playtest = playtest;
    this.assistant = new AuthorDraftAssistant({ request: requestDraft });
    this.selectedAnchorId = adventurePackage.graph.nodes[0]?.id ?? null;
    this.currentDraft = null;

    this.root = document.createElement('aside');
    this.root.className = 'adventure-workbench';
    this.root.innerHTML = `
      <header class="adventure-workbench__header">
        <div><span class="adventure-workbench__kicker">LOCAL AUTHORING · DEVELOPMENT ONLY</span>
        <h1>城市冒险工作台</h1></div>
        <button type="button" data-action="close" aria-label="关闭工作台">×</button>
      </header>
      <div class="adventure-workbench__body">
        <section class="adventure-workbench__card" data-panel="metadata">
          <h2>城市与版本</h2>
          <div class="adventure-workbench__fields"></div>
        </section>
        <section class="adventure-workbench__card">
          <h2>内容编辑</h2>
          <label>内容域<select data-field="section"></select></label>
          <textarea data-field="section-json" spellcheck="false"></textarea>
          <button type="button" data-action="apply-section">应用该内容域</button>
        </section>
        <section class="adventure-workbench__card adventure-workbench__relations">
          <h2>关系检查</h2>
          <div><h3>剧情可达性</h3><ol data-view="story"></ol></div>
          <div><h3>地理 Street View 路线</h3><ol data-view="geographic"></ol></div>
        </section>
        <section class="adventure-workbench__card">
          <h2>官方 Street View 预览与语义校准</h2>
          <label>锚点<select data-field="anchor"></select></label>
          <div class="adventure-workbench__actions">
            <button type="button" data-action="preview">在官方 viewer 预览</button>
            <button type="button" data-action="playtest">从此锚点作者预演</button>
          </div>
          <div class="adventure-workbench__calibration">
            <label>地理范围 m<input data-calibration="radiusMetres" type="number" min="1"></label>
            <label>方位容差 °<input data-calibration="headingTolerance" type="number" min="0" max="180"></label>
            <label>俯仰容差 °<input data-calibration="pitchTolerance" type="number" min="0" max="90"></label>
            <label>道路关系<input data-calibration="roadRelationship" placeholder="same-road / across-road"></label>
            <label>转场<select data-calibration="transition"><option>coordinate</option><option>walk</option><option>narrative</option></select></label>
          </div>
          <button type="button" data-action="calibrate">读取当前官方 viewer 语义状态</button>
          <button type="button" data-action="accept-layout">人工接受当前真实布局</button>
          <p class="adventure-workbench__note">只保存坐标、方向、俯仰、范围、道路关系与转场；不保存影像、像素热点或 panorama ID。真实布局仍需人工接受。</p>
        </section>
        <section class="adventure-workbench__card">
          <h2>校验与版本化文本包</h2>
          <div class="adventure-workbench__actions">
            <button type="button" data-action="validate-development">Development 校验</button>
            <button type="button" data-action="validate-production">Production 校验</button>
            <button type="button" data-action="export">导出 JSON</button>
          </div>
          <textarea data-field="package-text" spellcheck="false" placeholder="在此粘贴版本化文本包"></textarea>
          <button type="button" data-action="import">导入并替换当前草稿</button>
          <ol class="adventure-workbench__diagnostics" data-view="diagnostics"></ol>
        </section>
        <section class="adventure-workbench__card">
          <h2>可选 AI 剧情草稿</h2>
          <label>结构化案件简介<textarea data-field="ai-brief" placeholder='{"city":"New York","caseId":"..."}'></textarea></label>
          <label>来源摘要（每行一条）<textarea data-field="ai-sources"></textarea></label>
          <label>作者选中的短参考（每行一条）<textarea data-field="ai-references"></textarea></label>
          <button type="button" data-action="generate-ai">显式生成未审核草稿</button>
          <label>作者编辑<textarea data-field="ai-result" disabled></textarea></label>
          <button type="button" data-action="accept-ai" disabled>接受已编辑草稿到当前锚点</button>
          <p class="adventure-workbench__note">密钥只存在本地 Vite 服务端环境；生成内容标记为 unreviewed，作者编辑并接受前 production 校验拒绝发布。</p>
        </section>
      </div>
      <output class="adventure-workbench__status" data-view="status">工作台已打开。</output>
    `;
    parent.appendChild(this.root);
    this.toggle = document.createElement('button');
    this.toggle.type = 'button';
    this.toggle.className = 'adventure-workbench-toggle';
    this.toggle.textContent = '返回作者工作台';
    this.toggle.hidden = true;
    this.toggle.addEventListener('click', () => {
      this.root.hidden = false;
      this.toggle.hidden = true;
    });
    parent.appendChild(this.toggle);
    this._bind();
    this.render();
  }

  _bind() {
    this.root.querySelector('[data-action="close"]').addEventListener('click', () => this.dispose());
    this.root.querySelector('[data-field="section"]').addEventListener('change', () => this._renderSection());
    this.root.querySelector('[data-field="anchor"]').addEventListener('change', (event) => {
      this.selectedAnchorId = event.target.value;
      this._renderCalibration();
    });
    this.root.querySelector('[data-action="apply-section"]').addEventListener('click', () => this._applySection());
    this.root.querySelector('[data-action="preview"]').addEventListener('click', () => this._run(async () => {
      const result = await this.workbench.previewAnchor(this.selectedAnchorId);
      if (!result?.ok) throw new Error(result?.reason ?? 'preview-failed');
      return '官方 Street View 预览已导航；尚未自动标记为验收通过。';
    }));
    this.root.querySelector('[data-action="calibrate"]').addEventListener('click', () => this._run(() => {
      const options = Object.fromEntries([...this.root.querySelectorAll('[data-calibration]')]
        .map((input) => [input.dataset.calibration,
          input.type === 'number' ? Number(input.value) : input.value]));
      this.workbench.calibrateAnchor(this.selectedAnchorId, options);
      this.render();
      return '已保存语义校准；状态为 needs-human-acceptance。';
    }));
    this.root.querySelector('[data-action="accept-layout"]').addEventListener('click', () => this._run(() => {
      this.workbench.acceptStreetViewLayout(this.selectedAnchorId);
      this.render();
      return '当前真实 Street View 布局已由作者人工接受。';
    }));
    this.root.querySelector('[data-action="playtest"]').addEventListener('click', () => this._run(async () => {
      await this.playtest(this.workbench.package, this.selectedAnchorId);
      this.root.hidden = true;
      this.toggle.hidden = false;
      return '作者预演已开始；不会写 discovery 或 telemetry。';
    }));
    this.root.querySelector('[data-action="validate-development"]').addEventListener('click', () => this._validate('development'));
    this.root.querySelector('[data-action="validate-production"]').addEventListener('click', () => this._validate('production'));
    this.root.querySelector('[data-action="export"]').addEventListener('click', () => this._export());
    this.root.querySelector('[data-action="import"]').addEventListener('click', () => this._run(() => {
      this.workbench.import(this.root.querySelector('[data-field="package-text"]').value);
      this.selectedAnchorId = this.workbench.package.graph.nodes[0]?.id ?? null;
      this.render();
      return '文本包已确定性导入。';
    }));
    this.root.querySelector('[data-action="generate-ai"]').addEventListener('click', () => this._generateDraft());
    this.root.querySelector('[data-action="accept-ai"]').addEventListener('click', () => this._acceptDraft());
  }

  render() {
    this._renderMetadata();
    this._renderSelectors();
    this._renderSection();
    this._renderRelationships();
    this._renderCalibration();
  }

  _renderMetadata() {
    const fields = this.root.querySelector('.adventure-workbench__fields');
    fields.replaceChildren();
    for (const [key, label] of [['id', 'Package ID'], ['version', '版本'], ['status', '状态'], ['title', '标题'], ['city', '城市']]) {
      const wrapper = document.createElement('label');
      wrapper.textContent = label;
      const input = document.createElement('input');
      input.value = this.workbench.package[key] ?? '';
      input.addEventListener('change', () => {
        this.workbench.update(key, input.value);
        this._renderRelationships();
      });
      wrapper.appendChild(input);
      fields.appendChild(wrapper);
    }
  }

  _renderSelectors() {
    const section = this.root.querySelector('[data-field="section"]');
    const selectedSection = section.value || SECTIONS[0][0];
    section.replaceChildren(...SECTIONS.map(([value, label]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      return option;
    }));
    section.value = selectedSection;

    const anchor = this.root.querySelector('[data-field="anchor"]');
    anchor.replaceChildren(...this.workbench.package.graph.nodes.map((node) => {
      const option = document.createElement('option');
      option.value = node.id;
      option.textContent = `${node.id} · ${node.title}`;
      return option;
    }));
    anchor.value = this.selectedAnchorId;
  }

  _renderSection() {
    const path = this.root.querySelector('[data-field="section"]').value || SECTIONS[0][0];
    this.root.querySelector('[data-field="section-json"]').value =
      JSON.stringify(atPath(this.workbench.package, path) ?? null, null, 2);
  }

  _applySection() {
    this._run(() => {
      const path = this.root.querySelector('[data-field="section"]').value;
      const value = JSON.parse(this.root.querySelector('[data-field="section-json"]').value);
      this.workbench.update(path, value);
      this.selectedAnchorId = this.workbench.package.graph.nodes
        .some((node) => node.id === this.selectedAnchorId)
        ? this.selectedAnchorId
        : this.workbench.package.graph.nodes[0]?.id;
      this.render();
      return `${path} 已更新。`;
    });
  }

  _renderRelationships() {
    const relationships = this.workbench.relationships();
    const story = this.root.querySelector('[data-view="story"]');
    const storyItems = relationships.story.nodes.map((node) => {
      const item = document.createElement('li');
      item.textContent = `${node.reachable ? '可达' : '不可达'} · ${node.id} · ${node.segment}`;
      item.dataset.state = node.reachable ? 'ok' : 'error';
      return item;
    });
    for (const edge of relationships.story.edges) {
      const item = document.createElement('li');
      item.textContent = `剧情边 · ${edge.from} → ${edge.to}`;
      storyItems.push(item);
    }
    story.replaceChildren(...storyItems);
    const geographic = this.root.querySelector('[data-view="geographic"]');
    geographic.replaceChildren(...relationships.geographic.routes.map((route) => {
      const item = document.createElement('li');
      item.textContent = `${route.from} → ${route.to} · ${route.transition} · ${route.routeStatus}`;
      return item;
    }));
  }

  _renderCalibration() {
    const node = this.workbench.package.graph.nodes.find((item) => item.id === this.selectedAnchorId);
    if (!node) return;
    const target = node.streetViewTarget ?? {};
    for (const input of this.root.querySelectorAll('[data-calibration]')) {
      input.value = target[input.dataset.calibration] ?? (input.type === 'number' ? 0 : '');
    }
  }

  _validate(level) {
    const diagnostics = this.workbench.validate(level);
    const list = this.root.querySelector('[data-view="diagnostics"]');
    list.replaceChildren(...diagnostics.map((entry) => {
      const item = document.createElement('li');
      item.textContent = `${entry.code} · ${entry.path} · ${entry.message}`;
      return item;
    }));
    this._status(diagnostics.length
      ? `${level} 校验发现 ${diagnostics.length} 个问题。`
      : `${level} 校验通过。`);
  }

  _export() {
    const text = this.workbench.export();
    this.root.querySelector('[data-field="package-text"]').value = text;
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    link.download = `${this.workbench.package.id}-${this.workbench.package.version}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
    this._status('已导出确定性、可审阅的版本化 JSON 文本包。');
  }

  async _generateDraft() {
    await this._run(async () => {
      const briefText = this.root.querySelector('[data-field="ai-brief"]').value;
      this.currentDraft = await this.assistant.generate({
        brief: JSON.parse(briefText),
        sourceSummaries: this._lines('[data-field="ai-sources"]'),
        shortReferences: this._lines('[data-field="ai-references"]'),
      });
      const result = this.root.querySelector('[data-field="ai-result"]');
      result.disabled = false;
      result.value = this.currentDraft.content;
      this.root.querySelector('[data-action="accept-ai"]').disabled = false;
      return '草稿已生成并标记为 unreviewed；请编辑后人工接受。';
    });
  }

  _acceptDraft() {
    this._run(() => {
      const accepted = this.assistant.accept(this.currentDraft, {
        content: this.root.querySelector('[data-field="ai-result"]').value,
      });
      const index = this.workbench.package.graph.nodes
        .findIndex((node) => node.id === this.selectedAnchorId);
      this.workbench.update(`graph.nodes.${index}.dialogueDraft`, accepted);
      this.currentDraft = null;
      this.render();
      return '已把人工编辑并接受的草稿写入当前锚点。';
    });
  }

  _lines(selector) {
    return this.root.querySelector(selector).value.split('\n').map((line) => line.trim()).filter(Boolean);
  }

  async _run(operation) {
    try {
      this._status('处理中…');
      this._status(await operation());
    } catch (error) {
      this._status(`错误：${error.message}`);
    }
  }

  _status(message) {
    this.root.querySelector('[data-view="status"]').textContent = message;
  }

  dispose() {
    this.toggle.remove();
    this.root.remove();
  }
}
