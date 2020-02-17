
/**
 * Main user interface of openEASE.
 * The ui contains a Prolog console,
 * a library of predefined queries,
 * a webgl canvas and some widgets for
 * displaying graphics and statistics.
 **/
function KnowrobUI(flask_user,options) {
    var that = this;
    
    // qid-QueryCard map
    this.queryCards = {};
    // connect to ROS on host via websocket
    this.client = new ROSClient({
        flask_user:     flask_user,
        ros_url:        options.ros_url,
        authentication: options.authentication,
        auth_url: '/api/v1.0/auth_by_session'
    });
    // query id of most recent query
    this.last_qid = undefined;
    // a console used to send queries to KnowRob
    this.console = new PrologConsole(that.client, {
        query_div: 'user_query',
        on_query: function(qid,q) {
            $('#btn_query_next').prop('disabled', false);
            var last_query_card = that.queryCards[that.last_qid];
            if(last_query_card) {
                last_query_card.collapse();
            }
            that.last_qid = qid;
            that.queryCards[qid] = new QueryCard("#history",qid,q);
        },
        on_query_answer: function(qid,answer) {
            that.queryCards[qid].addQueryResponse(answer);
        },
        on_query_finish: function(qid) {
            $('#btn_query_next').prop('disabled', true);
            that.queryCards[qid].finish();
        }
    });
    // the 3D visualization canvas
    this.rosViewer = undefined;

    this.init = function () {
        that.console.init();
        that.initCanvas();
        that.client.connect(function(ros) {
            that.registerROSClients(ros);
            that.rosViewer.registerNodes(ros);
        });
        that.resizeCanvas();
    };
    
    // create a ROSCanvas in the "markers" div.
    this.initCanvas = function() {
        if(that.rosViewer) {
          delete that.rosViewer;
          document.getElementById('markers').innerHTML = "";
        }
        that.rosViewer = new ROSCanvas({
            divID: document.getElementById('markers'),
            // meshPath is the prefix for GET requests
            meshPath: '/meshes/'
        });
        that.rosViewer.on_camera_pose_received = that.setCameraPose;
        that.rosViewer.on_unselect_marker = function(marker) {
            that.rosViewer.rosViewer.unhighlight(marker);
            that.initQueryLibrary(marker);
        };
        that.rosViewer.on_select_marker = function(marker) {
            that.rosViewer.rosViewer.highlight(marker);
            that.loadMarkerQueries(marker);
        };
        that.rosViewer.on_remove_marker = function(marker) {
            if(marker === that.rosViewer.selectedMarker) {
                that.initQueryLibrary();
            }
        };
        that.rosViewer.on_window_dblclick = function() {
            if(that.rosViewer.selectedMarker) {
                that.initQueryLibrary();
                that.rosViewer.unselectMarker();
            }
        };
    };

    this.resizeCanvas = function () {
        that.rosViewer.resize($('#markers').width(), $('#markers').height());
    };
    
    this.setCameraPose = function (pose) {
        that.rosViewer.setCameraPose(pose);
    };
    
    // listen to some ROS topics
    this.registerROSClients = function (ros) {
        that.registerChartClient(ros);
        that.registerImageClient(ros);
        that.loadNEEM();
    };
    
    // listen to data_vis_msgs topic and add charts to currently
    // active query card
    this.registerChartClient = function(ros) {
        that.dataVis = new ROSLIB.Topic({
            ros : ros,
            name : 'data_vis_msgs',
            messageType : 'data_vis_msgs/DataVis'
        });
        that.dataVis.subscribe(function(data_vis_msg) {
            if(that.last_qid) {
                that.queryCards[that.last_qid].addChart(data_vis_msg);
            }
            else {
                console.warn("Received DataVis msg, but no query is active.");
            }
        });
    };
    
    // listen to logged_images topic and add images to currently
    // active query card
    this.registerImageClient = function(ros) {
        that.imageVis = new ROSLIB.Topic({
            ros : ros,
            name : 'logged_images',
            messageType : 'std_msgs/String'
        });
        that.imageVis.subscribe(function(image_uri) {
            if(that.last_qid) {
                var ext = image_uri.data.substr(
                    image_uri.data.lastIndexOf('.') + 1).toLowerCase();
                if(ext=='jpg' || ext =='png') {
                    that.queryCards[that.last_qid].addImage(image_uri);
                }
                else if(ext =='ogg' || ext =='ogv' || ext =='mp4' || ext =='mov') {
                    that.queryCards[that.last_qid].addVideo(image_uri);
                }
                else {
                    console.warn("Unknown data format on /logged_images topic: " + message.data);
                }
            }
            else {
                console.warn("Received logged_image msg, but no query is active.");
            }
        });
    };
    
//     this.registerHighlightClient = function() {
//         that.highlightClient = new ROSLIB.Topic({
//             ros : that.client.ros,
//             name : '/openease/highlight',
//             messageType : 'knowrob_openease/Highlight'
//         });
//         that.highlightClient.subscribe(function(msg) {
//           var r = msg.color.r;
//           var g = msg.color.g;
//           var b = msg.color.b;
//           var a = msg.color.a;
//           for(var i in msg.objects) {
//               var o = msg.objects[i];
//               var marker = that.client.markerArrayClient.getObjectMarker(o.toString());
//               if(!marker) continue;
//               if(r>0 || g>0 || b>0 || a>0) {
//                   that.rosViewer.highlight(marker, [r,g,b,a]);
//               } else {
//                   that.rosViewer.unhighlight(marker);
//               }
//           }
//         });
//     };
    
    this.loadNEEM = function() {
        var prolog = new ROSPrologClient(that.client.ros, {});
        // FIXME: "belief_existing_objects(_Os), mark_dirty_objects(_Os)" should not be required.
        prolog.jsonQuery("mem_import_owl('/neem/neem-narrative'), belief_existing_objects(_Os), mark_dirty_objects(_Os).",
            function(result) {
                prolog.finishClient();
            }
        );
    };
    
    ///////////////////////////////
    //////////// Query Library
    ///////////////////////////////
    
//     this.loadQueriesForObject = function(objectName) {
//         var prolog = new ROSPrologClient(that.client.ros, {});
//         prolog.jsonQuery("object_queries("+objectName+",Queries).",
//             function(result) {
//                 prolog.finishClient();
//                 if(result.solution)
//                     that.loadObjectQueries(result.solution.Queries);
//             }
//         );
//     };
    
//     this.loadObjectQueries = function(queries) {
//         // parse query and add to category--queries map
//         var queryLibMap = {};
//         for(var i=0; i<queries.length; i++) {
//             var category = queries[i][0];
//             var title = queries[i][1];
//             var query = queries[i][2];
//             if(!query.endsWith(".")) query += ".";
//             
//             if(queryLibMap[category]==undefined) queryLibMap[category]=[];
//             queryLibMap[category].push({q: query, text: title});
//         }
//         // flatten the map into queryLib array
//         var queryLib = [];
//         var categories = Object.keys(queryLibMap);
//         categories.sort();
//         for(var i=0; i<categories.length; i++) {
//             queryLib.push({q: "", text: "----- " + categories[i] + " -----"});
//             queryLib.push.apply(queryLib, queryLibMap[categories[i]]);
//         }
//         
//         that.initQueryLibrary(queryLib);
//     };
    
//     this.loadMarkerQueries = function(marker) {
//         var prolog = new ROSPrologClient(that.client.ros, {});
//         prolog.jsonQuery("term_to_atom("+marker.ns+",MarkerName), "+
//             "marker_queries(MarkerName, MarkerQueries).",
//             function(result) {
//                 prolog.finishClient();
//                 if(result.solution)
//                     that.loadObjectQueries(result.solution.MarkerQueries);
//             }
//         );
//     };
    
//     this.initQueryLibrary = function (queries) {
//         function loadQueries(query_lib) {
//             var lib_div = document.getElementById('library_content');
//             if(lib_div !== null && query_lib) {
//                 lib_div.innerHTML = '';
//                 
//                 var query = query_lib.query || query_lib;
//                 for (var i = 0; i < query.length; i++) {
//                     if(!query[i].text) continue;
// 
//                     var text = query[i].text.trim();
//                     if(text.length==0) continue;
//                     
//                     if(text.startsWith('-----')) {
//                         // insert space between sections
//                         if(i>0) {
//                             var x = document.createElement('div');
//                             x.className = 'query_lib_space';
//                             lib_div.appendChild(x);
//                         }
//                         
//                         var x = document.createElement('div');
//                         x.className = 'query_lib_header';
//                         x.innerHTML = text.split("-----")[1].trim();
//                         lib_div.appendChild(x);
//                     }
//                     else if(query[i].q) {
//                         var x = document.createElement('button');
//                         x.type = 'button';
//                         x.value = query[i].q;
//                         x.className = 'query_lib_button';
//                         x.innerHTML = text;
//                         lib_div.appendChild(x);
//                     }
//                 }
//                 that.queryLibrary = query;
//             }
//             
//             $( "button.query_lib_button" )
//                 .focus(function( ) {
//                     that.console.setQueryValue( $(this)['0'].value );
//                 });
//         };
//         
//         if(queries == undefined) {
//           // TODO: only dowload if required!
//             // FIXME
//           //that.client.episode.queryEpisodeData(loadQueries);
//         }
//         else {
//             loadQueries(queries);
//         }
//     };
    
//     $("#library_content").keydown(function(e) {
//         var button = $(".query_lib_button:focus");
//         if (e.keyCode == 40) { // down
//             for(var next=button.next(); next.length>0; next=next.next()) {
//                 if(next.hasClass('query_lib_button')) {
//                     next.focus();
//                     next.click();
//                     break;
//                 }
//             }
//             e.preventDefault();
//         }
//         else if (e.keyCode == 38) { // up
//             for(var prev=button.prev(); prev.length>0; prev=prev.prev()) {
//                 if(prev.hasClass('query_lib_button')) {
//                     prev.focus();
//                     prev.click();
//                     break;
//                 }
//             }
//             e.preventDefault();
//         }
//         else if (e.keyCode == 32) { // space
//             e.preventDefault();
//             that.console.query();
//         }
//     });
};