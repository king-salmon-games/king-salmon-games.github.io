(() => {
  'use strict';

  const form = document.querySelector('#wishlist-form');
  if (!form) return;

  const games = [...form.querySelectorAll('input[name="game"]')];
  const all = form.querySelector('#select-all');
  const email = form.querySelector('#wishlist-email');
  const status = form.querySelector('#selection-status');
  const message = form.querySelector('#signup-message');
  const copy = form.querySelector('#copy-message');
  const copyStatus = form.querySelector('#copy-status');
  const requested = new URLSearchParams(window.location.search).getAll('game');

  for (const game of games) {
    game.checked = requested.includes('all') || requested.includes(game.value);
  }

  function updateSelection() {
    const selected = games.filter(game => game.checked);
    all.checked = selected.length === games.length;
    all.indeterminate = selected.length > 0 && !all.checked;
    status.textContent = selected.length
      ? `${selected.length} of ${games.length} games selected.`
      : 'Choose one or more games to continue.';
    email.hidden = selected.length === 0;
    copy.disabled = selected.length === 0;
    copyStatus.textContent = '';

    if (!selected.length) {
      email.removeAttribute('href');
      message.value = 'Choose your games above to prepare a signup message.';
      return;
    }

    const subject = 'King Salmon Games wishlist';
    const body = [
      'Hi King Salmon Games,',
      '',
      'Please add me to the email wishlists for:',
      ...selected.map(game => `- ${game.dataset.title}`),
      '',
      'I would like development news, playtesting opportunities, and launch updates for these games.',
      '',
      'Thank you!'
    ].join('\r\n');

    email.href = `mailto:bigkingsalmongames@gmail.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    message.value = `Subject: ${subject}\r\n\r\n${body}`;
  }

  all.addEventListener('change', () => {
    for (const game of games) game.checked = all.checked;
    updateSelection();
  });
  for (const game of games) game.addEventListener('change', updateSelection);
  form.addEventListener('submit', event => event.preventDefault());
  email.addEventListener('click', () => {
    status.textContent = 'Your email app should open. Send the prepared message to join your selected wishlists.';
  });
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(message.value);
      copyStatus.textContent = 'Message copied. Paste it into your email and send it to us to join.';
    } catch {
      message.focus();
      message.select();
      copyStatus.textContent = 'Select and copy the message, then paste it into your email.';
    }
  });

  updateSelection();
  form.hidden = false;
})();
