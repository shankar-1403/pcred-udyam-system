// Static markup for the "Details we read" and "Three quick questions" cards.
// The report engine (src/report/engine.js) fills and wires these elements by id,
// so React renders them once and never re-renders their contents.
export const DETAILS_CARD_HTML = `<div class="card__head"><span class="card__num">2</span><h2>Details we read</h2></div>
        <p class="card__sub" id="details-sub">These details appear after you verify a Udyam Registration Number.</p>
        <div class="fields">
          <div class="field" data-f="name"><label for="f-name">Business name</label><input id="f-name" type="text" autocomplete="off"><span class="src" id="s-name"></span></div>
          <div class="field" data-f="urn"><label for="f-urn">Udyam number</label><input id="f-urn" class="mono" type="text" autocomplete="off" spellcheck="false" placeholder="UDYAM-XX-00-0000000"><span class="src" id="s-urn"></span></div>
          <div class="field" data-f="size"><label for="f-size">Category</label><select id="f-size"><option value="">Choose…</option><option value="micro">Micro</option><option value="small">Small</option><option value="medium">Medium</option></select><span class="src" id="s-size"></span></div>
          <div class="field" data-f="activity"><label for="f-activity">Main activity</label><select id="f-activity"><option value="">Choose…</option><option value="manufacturing">Manufacturing</option><option value="services">Services</option><option value="trading">Trading</option></select><span class="src" id="s-activity"></span></div>
          <div class="field" data-f="social"><label for="f-social">Owner's social category</label><select id="f-social"><option value="">Choose…</option><option value="general">General</option><option value="obc">OBC</option><option value="sc">SC</option><option value="st">ST</option></select><span class="src" id="s-social"></span></div>
          <div class="field" data-f="state"><label for="f-state">State / UT</label><select id="f-state"><option value="">Choose…</option></select><span class="src" id="s-state"></span></div>
          <div class="field" data-f="district"><label for="f-district">District</label><input id="f-district" type="text" autocomplete="off"><span class="src" id="s-district"></span></div>
          <div class="field" data-f="orgType"><label for="f-orgType">Business type</label><select id="f-orgType"><option value="">Choose…</option><option value="proprietorship">Proprietorship</option><option value="partnership">Partnership firm</option><option value="llp">LLP</option><option value="pvt">Private limited company</option><option value="public">Public limited company</option><option value="other">Other (HUF, trust, society, co-op)</option></select><span class="src" id="s-orgType"></span></div>
          <div class="field" data-f="commenced"><label for="f-commenced">Started business</label><input id="f-commenced" type="text" inputmode="numeric" placeholder="dd/mm/yyyy" autocomplete="off"><span class="src" id="s-commenced"></span></div>
          <div class="field" data-f="nic"><label for="f-nic">NIC codes</label><input id="f-nic" class="mono" type="text" autocomplete="off" spellcheck="false" placeholder="e.g. 25920, 46307"><span class="src" id="s-nic"></span><ul class="nic-list" id="nic-list"></ul></div>
        </div>`;
export const QUESTIONS_CARD_HTML = `<div class="card__head"><span class="card__num">3</span><h2>Three quick questions</h2></div>
        <div class="q">
          <div class="q__label" id="q1">Is the business at least 51% owned by women?</div>
          <div class="seg" role="group" aria-labelledby="q1">
            <button type="button" id="w-yes" aria-pressed="false">Yes</button>
            <button type="button" id="w-no" aria-pressed="false">No</button>
          </div>
        </div>
        <div class="q">
          <div class="q__label" id="q2">What do you want help with?</div>
          <div class="q__hint">Pick any. Export and startup benefits show when you pick them.</div>
          <div class="chips" role="group" aria-labelledby="q2" id="goals"></div>
        </div>
        <div class="q" id="q-loan" hidden>
          <div class="q__label" id="q3">How much credit do you need?</div>
          <div class="chips" role="group" aria-labelledby="q3" id="loans"></div>
        </div>
        <a class="btn btn--ghost btn--sm to-report" href="#report">See the report ↓</a>`;
