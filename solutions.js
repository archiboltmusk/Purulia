// Problem -> where to go. Static index; every href is a page on this site.
// Add a row only when its page exists. No figures here: facts stay on their own pages.
(function () {
  var INDEX = [
    { title: 'Snakebite or a snake in the house', words: 'snake snakebite bite rescue rescuer cobra venom', href: 'snakes.html', text: 'Report a sighting, or find an approved rescuer near you.' },
    { title: 'Stray dogs and feeding', words: 'dog dogs stray feed feeding animal abc', href: 'dogs.html', text: 'Community dog feeding spots and the rules that apply.' },
    { title: 'Blood, blood donors and blood banks', words: 'blood donor donate bank thalassemia platelet rakt', href: 'blood.html', text: 'Blood donation facts and the official eRaktKosh stock service.' },
    { title: 'Drinking water and tap water', words: 'water tap drinking supply jal jjm pipe', href: 'data.html', text: 'Tap-water coverage figures for each district, with their sources.' },
    { title: 'Garbage, waste and cleanliness', words: 'garbage waste trash dustbin clean swachh drain', href: 'waste.html', text: 'Waste collection and cleanliness by place.' },
    { title: 'Toilets', words: 'toilet latrine sanitation washroom', href: 'toilets.html', text: 'Public toilets reported and checked.' },
    { title: 'Schools', words: 'school teacher classroom education udise', href: 'schools.html', text: 'Schools by district and what they report.' },
    { title: 'Puja pandals', words: 'pandal puja durga festival', href: 'pandals.html', text: 'Pandals that signed up for a clean site during the puja.' },
    { title: 'Adopt a spot', words: 'adopt spot park pond clean volunteer', href: 'adopt.html', text: 'Adopt a public spot and keep it clean.' },
    { title: 'Volunteer groups', words: 'volunteer group community team help join', href: 'communities.html', text: 'Local groups that work on civic problems.' },
    { title: 'Promises and claims', words: 'promise claim announcement minister mla mp government', href: 'promises.html', text: 'What was promised, and what the record shows.' },
    { title: 'Demands to leaders', words: 'demand leader notice board ask petition', href: 'noticeboard.html', text: 'Public demands put to local leaders.' },
    { title: 'Money and spending', words: 'money budget tax spending fund mplads', href: 'money.html', text: 'State finances and MP funds, from official sources.' },
    { title: 'Compare districts', words: 'compare district statistics census data', href: 'compare.html', text: 'Side-by-side district figures from official surveys.' },
    { title: 'Official records', words: 'record evidence document rti order court', href: 'record.html', text: 'Sourced documents and the cases they belong to.' },
    { title: 'Report a civic problem', words: 'road pothole streetlight light drain water leak problem report complaint', href: 'kasa.html', text: 'Report it with a live photo and your location. Reports go to the people who can fix it.' },
    { title: 'Complaint to a central government department', words: 'complaint grievance cpgrams central department', href: 'helplines.html', text: 'CPGRAMS and how to use it.' },
    { title: 'Free legal aid', words: 'legal aid lawyer court nalsa 15100 help', href: 'helplines.html', text: 'NALSA free legal aid helpline, 15100.' },
    { title: 'Information under the RTI Act', words: 'rti information right law officer file', href: 'helplines.html', text: 'RTI Online for central bodies, with the official helpline.' },
    { title: 'Ask a question about this site', words: 'help question how use ask assistant', href: 'assistant.html', text: 'Ask the help assistant.' }
  ];

  var input = document.getElementById('sol-q');
  var list = document.getElementById('sol-results');

  // Every word typed must appear in the title or keywords of a row.
  function matches(row, terms) {
    var hay = (row.title + ' ' + row.words).toLowerCase();
    return terms.every(function (t) { return hay.indexOf(t) !== -1; });
  }

  function render() {
    var terms = input.value.toLowerCase().split(/\s+/).filter(Boolean);
    list.textContent = '';
    if (!terms.length) return;
    var hits = INDEX.filter(function (row) { return matches(row, terms); });
    if (!hits.length) {
      var empty = document.createElement('li');
      empty.className = 'sol-empty';
      empty.textContent = 'Nothing matches yet. Try another word, or report the problem on the report page.';
      list.appendChild(empty);
      return;
    }
    hits.forEach(function (row) {
      var li = document.createElement('li');
      li.className = 'sol-item';
      var h = document.createElement('h2');
      h.textContent = row.title;
      var p = document.createElement('p');
      p.textContent = row.text;
      li.appendChild(h);
      li.appendChild(p);
      if (row.href) {
        var a = document.createElement('a');
        a.href = row.href;
        a.textContent = 'Open';
        li.appendChild(a);
      }
      list.appendChild(li);
    });
  }

  input.addEventListener('input', render);
})();
