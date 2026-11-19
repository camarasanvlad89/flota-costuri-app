import { html } from '../../ui/dom.js';
import { t } from '../../ui/strings.js';
import { GuideView } from '../../ui/guide/view.js';

function GuideScreen({ params }) {
  return html`<${GuideView} sectionId=${params.sectiune} />`;
}
export const screen = { id: 'guide', route: '/ghid/:sectiune?', title: () => t.nav.guideTitle, nav: { label: t.nav.guide, icon: 'help', order: 10, group: 'admin', path: '/ghid' }, component: GuideScreen };
