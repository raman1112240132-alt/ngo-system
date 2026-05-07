async function loadDashboard(){
  tbody.innerHTML = "";

  rooms.forEach(room=>{

    tbody.innerHTML += `
      <tr>
        <td>${room.name}</td>
        <td>${room.completion}%</td>
        <td>${room.missing.join(", ")}</td>
      </tr>
    `;

  });

}

function renderActivities(activities){

  const tbody = document.getElementById("activityTable");

  tbody.innerHTML = "";

  activities.forEach(a=>{

    tbody.innerHTML += `
      <tr>
        <td>${a.name}</td>
        <td>${a.expected}</td>
        <td>${a.conducted}</td>
        <td>${a.status}</td>
      </tr>
    `;

  });

}

let chart;

function renderSubjectChart(subjectCoverage){

  const labels = subjectCoverage.map(s=>s.subject);
  const values = subjectCoverage.map(s=>s.percent);

  const ctx = document.getElementById("subjectChart");

  if(chart){
    chart.destroy();
  }

  chart = new Chart(ctx, {
    type:'bar',
    data:{
      labels,
      datasets:[{
        label:'Completion %',
        data:values
      }]
    }
  });

}

window.onload = ()=>{

  const today = new Date();

  const month = today.toISOString().slice(0,7);

  document.getElementById("monthFilter").value = month;

  loadDashboard();

};