var express = require('express');
var mysql = require('promise-mysql');

// Express middleware
var bodyParser = require('body-parser'); // reads request bodies from POST requests
var cookieParser = require('cookie-parser'); // parses cookie from Cookie request header into an object
var morgan = require('morgan'); // logs every request on the console
var checkLoginToken = require('./lib/check-login-token.js'); // checks if cookie has a SESSION token and sets request.user
var onlyLoggedIn = require('./lib/only-logged-in.js'); // only allows requests from logged in users

// Controllers
var authController = require('./controllers/auth.js');

/*
 Load the RedditAPI class and create an API with db connection. This connection will stay open as
 long as the web server is running, which is 24/7.
 */
var RedditAPI = require('./lib/reddit.js');
var connection = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: 'root',
    database: 'redditDecode',
    connectionLimit: 10
});
var myReddit = new RedditAPI(connection);


// Create a new Express web server
var app = express();

// Specify the usage of the Pug template engine
app.set('view engine', 'pug');

/*
 This next section specifies the middleware we want to run.
 app.use takes a callback function that will be called on every request
 the callback function will receive the request object, the response object, and a next callback.
 this type of function is called a "middleware".
 express will run these middleware in a pipeline, one after the other on each request.
 the order the middleware are declared in is important. for example, the cookieParser middleware will
 add a .cookie property to the request object. the checkLoginToken middleware will then use request.cookie
 to check if a user is logged in. this means cookieParser needs to run before checkLoginToken.
 */

// This middleware will log every request made to your web server on the console.
app.use(morgan('dev'));

// This middleware will parse the POST requests coming from an HTML form, and put the result in request.body.
app.use(bodyParser.urlencoded({extended: false}));

// This middleware will parse the Cookie header from all requests, and put the result in request.cookies as an object.
app.use(cookieParser());

/*
This custom middleware checks in the cookies if there is a SESSION token and validates it.

NOTE: This middleware is currently commented out! Uncomment it once you've implemented the RedditAPI
method `getUserFromSession`
 */
app.use(checkLoginToken(myReddit));





/*
app.use can also take a path prefix as a parameter. the next app.use says that anytime the request URL
starts with /auth, the middleware exported by controllers/auth.js should be called.

this type of middleware is a common way to modularize code in an Express application. basicaly we're
saying that any URL under /auth has to do with authentication, and we put all the sub-routes in their
own file to prevent clutter and improve maintainability.

the file at controllers/auth.js contains what is called an Express Router. a Router is like a tiny
express application that takes care of its own set of paths. look at the file for more information.

The authController needs access to the RedditAPI to do its work, so we pass it as a parameter and the
controller gets returned from that function.
 */
app.use('/auth', authController(myReddit));

/*
 This next middleware will allow us to serve static files, as if our web server was a file server.
 To do this, we attach the middleware to the /static URL path. This means any URL that starts withvote
 /static will go thru this middleware. We setup the static middleware to look for files under the public
 directory which is at the root of the project. This basically "links" the public directory to a URL
 path called /static, and any files under /public can be requested by asking for them with /static
 followed by the path of those files.

 If you look in views/layout.pug, you'll see that we add a <link> tag referencing /static/app.css.
 This is a CSS file that is located in the public directory. For now the file is mostly empty, but
 you can add stuff to it if you want to make your site look better.

 Eventually you could also load browser JavaScript and make your site more dynamic. We will be looking
 at how to do this in the next few weeks but don't hesitate to take a head start.
 */
app.use('/static', express.static(__dirname + '/public'));

// Regular home Page
app.get('/', function(request, response) {
    myReddit.getAllPosts()
    .then(function(posts) {
        response.render('homepage', {posts: posts});
    })
    .catch(function(error) {
        response.render('error', {error: error});
    })
});

// Listing of subreddits
app.get('/subreddits', function(request, response) {
    /*
    1. Get all subreddits with RedditAPI
    2. Render some HTML that lists all the subreddits
     */
    myReddit.getSubreddits()
        .then(function(resultSet){
           response.render('subreddit-splash.pug', { subreddits: resultSet});
        });
});

// Subreddit homepage, similar to the regular home page but filtered by sub.
app.get('/r/:subreddit', function(request, response) {
    var subredditNameGlob = "";
    var subredditDescGlob = "";
    myReddit.getSubredditByName(request.params.subreddit)
        .then( function(resultSubredditSet) {
            if (resultSubredditSet === null){
                response.status(404).send("Subreddit NOT FOUND!");
            }
            var resultSubreddit = resultSubredditSet[0].id;
            subredditNameGlob = resultSubredditSet[0].name;
            subredditDescGlob =resultSubredditSet[0].description;
            return resultSubreddit;
        })
        .then( function(resultSubredditSet) {
            return myReddit.getAllPosts(resultSubredditSet);
        })
        .then( function(postsSubreddit) {
            response.render('homepage.pug',
                {
                posts : postsSubreddit,
                name  : subredditNameGlob,
                desc  : subredditDescGlob
                }
            );
        });
});

// Sorted home page
app.get('/sort/:method', function(request, response) {
    if (request.params.method === "hot"){
        myReddit.getAllPosts(false, "hot")
            .then(function (posts){
                response.render('homepage.pug', {posts: posts});
            });
    }
    else if (request.params.method === "top"){
        myReddit.getAllPosts(false, "top")
            .then(function (posts){
                response.render('homepage.pug', {posts: posts});
            });
    }
    else {
        response.redirect(404, '/');
    }
});

app.get('/post/:postId', function(request, response) {
    Promise.all([ myReddit.getSinglePost(request.params.postId), myReddit.getCommentsForPost(request.params.postId) ])
        .then(function(returnArray){
            if (returnArray[0].length === 0){
                response.redirect(404, '/'); //"If the post does not exist, return a 404."
            }
            console.log("HERE");
            var postObj  = returnArray[0];
            var comArray = returnArray[1]; //Array of comments
            console.log(returnArray[1]);
            response.render('single-post.pug', {
                postId        : request.params.postId, //could also use postObj.id
                postTitle     : postObj.title,
                postSubReddit : postObj.subreddit.name,
                postSubDesc   : postObj.subreddit.description,
                postUrl       : postObj.url,
                poster        : postObj.user.username,
                commentArray  : comArray
            });
        });
});

/*
This is a POST endpoint. It will be called when a form is submitted with method="POST" action="/vote"
The goal of this endpoint is to receive an up/down vote by a logged in user.
Since you can only vote if you are logged in, the onlyLoggedIn middleware is interposed before the final request handler.
The app.* methods of express can actually take multiple middleware, forming a chain that is only used for that path

This basically says: if there is a POST /vote request, first pass it thru the onlyLoggedIn middleware. If that
middleware calls next(), then also pass it to the final request handler specified.
 */
app.post('/vote', onlyLoggedIn, bodyParser.urlencoded({extended: false}), function(request, response) {
    var voteObj = {};
    voteObj.postId = request.body.postId;
    voteObj.voteDirection = parseInt(request.body.vote); //NOTE:NEED TO TURN STRING INTO NUM WHEN YOU RETRIEVE DATA FROM HTTP!!!
    voteObj.userId = request.loggedInUser.id;
    myReddit.createVote(voteObj)
        .then(function(resultSet){
            console.log(voteObj.userId + " votes " + voteObj.voteDirection)
            //TODO: Ask TAs/Ziad where to redirect after voting!
            response.redirect('back'); //NOTE: express 4.0+ supports 'back' which brings user to same page
        })
        .catch(function(err){
           console.log("vote error " + err);
           response.redirect(404, '/');
        });
});

// This handler will send out an HTML form for creating a new post
app.get('/createPost', onlyLoggedIn, function(request, response) {
    myReddit.getAllSubreddits()
        .then(function(resultSet){
            response.render('create-post-form.pug', {subreddits: resultSet});
        });
});

// POST handler for form submissions creating a new post
app.post('/createPost', onlyLoggedIn, bodyParser.urlencoded({extended: false}), function(request, response) {
    // console.log(request.loggedInUser.id); //NOTE: recall our check-login-token middleware that works by creating a loggedInUser Object we passed to it via getUserFromSession
    var postObj = {};
    postObj.userId = request.loggedInUser.id;
    postObj.subredditId = request.body.subredditId;
    postObj.title  = request.body.title;
    postObj.url    = request.body.url;
    console.log(request.body); //Recall that the POST form submits a query string with values in the input (plus the value in the option HTML tag)
    myReddit.createPost(postObj)
        .then(function(postIdResult){
            response.redirect('/post/' + postIdResult); // " Use the newly created posts' ID to redirect them to /post/<postId>"
        });
});

// Listen, added timer to know when server restarts (easier to debug and log)
var port = process.env.PORT || 3000;
var a = new Date();
var hour = a.getUTCHours();
var min = a.getUTCMinutes();
var sec = a.getUTCSeconds();
app.listen(port, function() {
    // This part will only work with Cloud9, and is meant to help you find the URL of your web server :)
    if (process.env.C9_HOSTNAME) {
        console.log('Web server is listening on https://' + process.env.C9_HOSTNAME + " " + hour + ":" + ":" + min + ":" + sec);
    }
    else {
        console.log('Web server is listening on http://localhost:' + port + " " + hour + ":" + min + ":" + sec);
    }
});