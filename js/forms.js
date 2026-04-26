function initForm(formId, endpoint, successMsg, transformFn) {
  var form = document.getElementById(formId);
  if (!form) return;

  form.addEventListener('submit', function(e) {
    e.preventDefault();

    var status = document.getElementById('form-status');
    var btn = form.querySelector('.form-submit-btn');

    status.style.display = 'block';
    status.className = 'form-status loading';
    status.textContent = 'Submitting...';
    btn.disabled = true;

    var body;
    if (transformFn) {
      body = transformFn(form);
    } else {
      var fd = new FormData(form);
      body = {};
      fd.forEach(function(val, key) { body[key] = val; });
    }

    fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    .then(function(resp) {
      if (!resp.ok) throw new Error('Submission failed — please try again.');
      return resp.json();
    })
    .then(function(data) {
      status.className = 'form-status success';
      status.textContent = typeof successMsg === 'function' ? successMsg(data) : successMsg;
      form.reset();
      btn.disabled = true;
      btn.textContent = 'Submitted';
    })
    .catch(function(err) {
      status.className = 'form-status error';
      status.textContent = err.message || 'Something went wrong. Please try again.';
      btn.disabled = false;
    });
  });
}
