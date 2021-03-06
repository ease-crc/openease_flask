import datetime

from flask_user import UserMixin

from app_and_db import app, db

# Define the User-Roles pivot table
user_roles = db.Table('user_roles',
                      db.Column('id', db.Integer(), primary_key=True),
                      db.Column('user_id', db.Integer(), db.ForeignKey('user.id', ondelete='CASCADE')),
                      db.Column('role_id', db.Integer(), db.ForeignKey('role.id', ondelete='CASCADE')))


class Role(db.Model):
    id = db.Column(db.Integer(), primary_key=True)
    name = db.Column(db.String(50), unique=True)


class NEEMLike(db.Model):
    __tablename__ = 'neem_like'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'))
    neem_id = db.Column(db.String(50), nullable=False)


class User(db.Model, UserMixin):
    id = db.Column(db.Integer, primary_key=True)
    active = db.Column(db.Boolean(), nullable=False, default=False)
    username = db.Column(db.String(50), nullable=False, unique=True)
    displayname = db.Column(db.String(50), nullable=False, default='')
    remoteapp = db.Column(db.String(50), nullable=False, default='')  # TODO(daniel): unused
    email = db.Column(db.String(255), nullable=False, unique=True)
    confirmed_at = db.Column(db.DateTime())
    password = db.Column(db.String(255), nullable=False, default='')
    reset_password_token = db.Column(db.String(100), nullable=False, default='')
    api_token = db.Column(db.String(64), nullable=False, default='')
    container_id = db.Column(db.String(255), nullable=False, default='')
    # Relationships
    roles = db.relationship('Role', secondary=user_roles,
                            backref=db.backref('users', lazy='dynamic'))
    liked = db.relationship('NEEMLike', foreign_keys='NEEMLike.user_id',
                            backref='user', lazy='dynamic')

    def first_role(self):
        if len(self.roles) == 0:
            return None
        else:
            return self.roles[0].name

    def like_neem(self, neem_id):
        if not self.has_liked_neem(neem_id):
            like = NEEMLike(user_id=self.id, neem_id=neem_id)
            db.session.add(like)

    def unlike_neem(self, neem_id):
        if self.has_liked_neem(neem_id):
            NEEMLike.query.filter_by(
                user_id=self.id,
                neem_id=neem_id).delete()

    def has_liked_neem(self, neem_id):
        return NEEMLike.query.filter(
            NEEMLike.user_id == self.id,
            NEEMLike.neem_id == neem_id).count() > 0


def create_role(role_name):
    if not Role.query.filter(Role.name == role_name).first():
        role = Role()
        role.name = role_name
        db.session.add(role)
        db.session.commit()


def add_user(user_manager, name, mail, pw,
             displayname='', remoteapp='', roles=[]):
    if pw is None or len(pw) < 4:
        app.logger.warn("User %s has no password specified." % name)
        return

    user = User.query.filter(User.username == name).first()
    if user:
        return user

    user = User(username=name,
                displayname=displayname,
                remoteapp=remoteapp,
                email=mail,
                active=True,
                password=user_manager.hash_password(pw),
                confirmed_at=datetime.datetime.utcnow())
    for r in roles:
        x = Role.query.filter(Role.name == r).first()
        if x is None:
            app.logger.info("Unable to find role: " + str(r))
        else:
            user.roles.append(x)
    db.session.add(user)
    db.session.commit()

    return user
