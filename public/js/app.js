$(function(){
  // Sidebar toggle
  $(".sidebar-toggle").click(function(){
    $(".sidebar").toggleClass("show");
  });

  // Setup QR polling
  if ($("#qr-box").length){
    function loadQR(){
      $.get("/wa/qr", function(data){
        if(data.qr){
          $("#qr-box").html(`<img src="${data.qr}" alt="QR Code" style="max-width:250px;">`);
          $("#wa-status").text("Scan QR via WhatsApp");
        } else if(data.connected){
          $("#qr-box").html(`<p class="success">✅ Connected</p>`);
          $("#wa-status").text("Connected");
        } else {
          $("#qr-box").html(`<p>Waiting QR...</p>`);
          $("#wa-status").text("Waiting...");
        }
      });
    }
    setInterval(loadQR, 3000);
    loadQR();
  }

  // Blast form
  $("#blast-form").submit(function(e){
    e.preventDefault();
    var formData = new FormData(this);
    $.ajax({
      url: "/wa/blast",
      type: "POST",
      data: formData,
      processData: false,
      contentType: false,
      success: function(res){
        Swal.fire("Blast selesai", "Pesan terkirim!", "success");
      },
      error: function(err){
        Swal.fire("Error", err.responseText, "error");
      }
    });
  });

  // Cancel blast
  $("#cancel-blast").click(function(){
    $.post("/wa/cancel", {}, function(){
      Swal.fire("Blast dibatalkan");
    });
  });

  // Blast progress
  if ($("#progress-text").length){
    var evt = new EventSource("/wa/progress");
    evt.onmessage = function(e){
      var p = JSON.parse(e.data);
      $("#progress-text").text(p.sent + "/" + p.total);
    };
  }

  // Templates
  $("#template-form").submit(function(e){
    e.preventDefault();
    $.post("/wa/templates", $(this).serialize(), function(){
      location.reload();
    });
  });

  $(".delete-template").click(function(){
    var id = $(this).data("id");
    $.ajax({ url: "/wa/templates/"+id, type: "DELETE", success: ()=>location.reload() });
  });
});
