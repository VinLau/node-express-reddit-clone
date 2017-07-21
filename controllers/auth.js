var express = require('express');
var bodyParser = require('body-parser');
var onlyLoggedIn = require('../lib/only-logged-in.js');

module.exports = function(myReddit) {
    var authController = express.Router();
    
    authController.get('/login', function(request, response) {
        response.render('../views/login-form.pug');
    });
    
    authController.post('/login', bodyParser.urlencoded({extended: false}), function(request, response) {
        if (!request.body) { return response.sendStatus(400); }
        console.log("Making a login POST request!");
        console.log(request.body);
        myReddit.checkUserLogin(request.body.username, request.body.password)
            .catch( function(err){
                console.log("login check unsuccessful" + err);
                response.redirect(401);
            })
            .then( function(resultUserObj) {
                var userIdParam = resultUserObj.id; //remember we got the full Object, createUserSession works via id (ie a field)
                return myReddit.createUserSession(userIdParam);
            })
            .then(function(sessionToken){
                response.cookie("SESSION", sessionToken);
                // console.log("sessionToken " + sessionToken);
                response.redirect(302, "/");
            })
    });

    authController.post('/logout', onlyLoggedIn, function(request, response){
        myReddit.deleteSessionFromTable(request.loggedInUser);
        response.clearCookie("SESSION");
        response.redirect(302, "/");
    })
    
    authController.get('/signup', function(request, response) {
        response.render('../views/signup-form.pug');
    });
    
    authController.post('/signup', bodyParser.urlencoded({extended: false}), function(request, response) {
        if (!request.body) { return response.sendStatus(400); }
        console.log("Making a signup POST request!");
        console.log(request.body);
        myReddit.createUser(request.body)
            .then( function () {
                response.status(302).redirect("/auth/login");
            })
            .catch( function(error) {
               console.log(error.stack);
               response.status(302).redirect(302, "/");
            });
    });
    
    return authController;
}